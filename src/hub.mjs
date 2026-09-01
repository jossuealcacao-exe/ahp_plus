import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { invariant } from './errors.mjs';
import { ensureDirectory, readJson, safeSegment, writeJsonExclusive } from './fs-utils.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

function protectedToken(fileOption) {
  invariant(fileOption, '--token-file is required', { code: 'NETWORK_AUTH_REQUIRED', exitCode: 2 });
  const file = path.resolve(String(fileOption));
  invariant(fs.existsSync(file), 'Hub token file does not exist', { code: 'NETWORK_AUTH_REQUIRED', exitCode: 2 });
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'Hub token must be a regular non-symlink file', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  if (process.platform !== 'win32') invariant((stat.mode & 0o077) === 0, 'Hub token permissions are unsafe; expected chmod 600', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  const value = fs.readFileSync(file, 'utf8').trim();
  invariant(Buffer.byteLength(value) >= 32, 'Hub token must contain at least 32 bytes', { code: 'NETWORK_AUTH_REQUIRED', exitCode: 2 });
  return value;
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(value)}\n`);
}

function bearerMatches(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(`Bearer ${expected}`);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function protectedTlsKey(fileOption) {
  const file = path.resolve(String(fileOption));
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'TLS key must be a regular non-symlink file', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  if (process.platform !== 'win32') invariant((stat.mode & 0o077) === 0, 'TLS key permissions are unsafe; expected chmod 600', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  return fs.readFileSync(file);
}

function route(urlValue) {
  const url = new URL(urlValue, 'http://localhost');
  const match = url.pathname.match(/^\/v1\/projects\/([^/]+)\/devices\/([^/]+)\/(messages|receipts)(?:\/([^/]+))?$/);
  if (!match) return null;
  const [, rawProject, rawDevice, kind, rawId] = match;
  return {
    project: safeSegment(decodeURIComponent(rawProject)),
    device: safeSegment(decodeURIComponent(rawDevice)),
    kind,
    id: rawId ? safeSegment(decodeURIComponent(rawId)).toUpperCase() : null,
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body exceeds 1 MiB'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function objectDirectory(dataDir, target) {
  return path.join(dataDir, target.project, target.device, target.kind);
}

export function createSecureHub(options = {}) {
  const token = protectedToken(options['token-file']);
  invariant(options['data-dir'], '--data-dir is required', { code: 'INVALID_ARGUMENT' });
  const dataDir = path.resolve(String(options['data-dir']));
  ensureDirectory(dataDir);
  const handler = async (request, response) => {
    try {
      if (!bearerMatches(request.headers.authorization, token)) {
        send(response, 401, { ok: false, error: 'UNAUTHORIZED' });
        return;
      }
      const target = route(request.url);
      if (!target) {
        send(response, 404, { ok: false, error: 'NOT_FOUND' });
        return;
      }
      const directory = objectDirectory(dataDir, target);
      if (request.method === 'GET' && !target.id) {
        ensureDirectory(directory);
        const items = fs.readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => readJson(path.join(directory, entry.name)))
          .filter((item) => {
            if (target.kind !== 'messages') return true;
            const expiresAt = Date.parse(item?.delivery?.expires_at || '');
            return !Number.isFinite(expiresAt) || expiresAt > Date.now();
          });
        send(response, 200, { ok: true, items });
        return;
      }
      if (request.method === 'PUT' && target.id) {
        const expectedPrefix = target.kind === 'messages' ? 'SEC-' : 'SRC-';
        if (!target.id.startsWith(expectedPrefix)) {
          send(response, 400, { ok: false, error: 'INVALID_OBJECT_ID' });
          return;
        }
        const value = await readBody(request);
        if (value?.id !== target.id) {
          send(response, 400, { ok: false, error: 'OBJECT_ID_MISMATCH' });
          return;
        }
        const file = path.join(directory, `${target.id}.json`);
        if (fs.existsSync(file)) {
          const identical = JSON.stringify(readJson(file)) === JSON.stringify(value);
          send(response, identical ? 200 : 409, { ok: identical, stored: false, duplicate: identical });
          return;
        }
        writeJsonExclusive(file, value);
        if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
        send(response, 201, { ok: true, stored: true, duplicate: false });
        return;
      }
      send(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      if (!response.headersSent) send(response, error.status || 500, { ok: false, error: error.message });
    }
  };
  if (options['tls-cert'] || options['tls-key']) {
    invariant(options['tls-cert'] && options['tls-key'], '--tls-cert and --tls-key must be provided together', { code: 'INVALID_ARGUMENT' });
    return https.createServer({
      cert: fs.readFileSync(path.resolve(String(options['tls-cert']))),
      key: protectedTlsKey(options['tls-key']),
    }, handler);
  }
  return http.createServer(handler);
}

export async function serveSecureHub(options = {}) {
  const host = String(options.host || '127.0.0.1');
  const port = Number(options.port || 8787);
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(host);
  invariant(loopback || (options['tls-cert'] && options['tls-key']), 'A non-loopback hub must use --tls-cert and --tls-key', {
    code: 'INSECURE_TRANSPORT', exitCode: 2,
  });
  const server = createSecureHub(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'HUB_LISTENING',
    protocol: server instanceof https.Server ? 'https' : 'http',
    host,
    port: typeof address === 'object' ? address.port : port,
    persistence: path.resolve(String(options['data-dir'])),
    payload_visibility: 'encrypted-objects-only',
  }, null, 2)}\n`);
  await new Promise((resolve) => {
    const close = () => server.close(resolve);
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}
