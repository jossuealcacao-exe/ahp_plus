import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { invariant } from './errors.mjs';
import { ensureDirectory, readJson, safeSegment, walkJson, writeJsonExclusive } from './fs-utils.mjs';
import { projectId, repository } from './state.mjs';
import {
  confirmSecureReceipts,
  findSecureEnvelope,
  prepareSecureEnvelope,
  receiveSecureEnvelopes,
} from './secure-relay.mjs';

function token(options) {
  const file = path.resolve(String(options['token-file'] || ''));
  invariant(options['token-file'] && fs.existsSync(file), '--token-file is required and must exist', { code: 'NETWORK_AUTH_REQUIRED', exitCode: 2 });
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'Network token must be a regular non-symlink file', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  if (process.platform !== 'win32') invariant((stat.mode & 0o077) === 0, 'Network token permissions are unsafe; expected chmod 600', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  const value = fs.readFileSync(file, 'utf8').trim();
  invariant(Buffer.byteLength(value) >= 32, 'Network token must contain at least 32 bytes', { code: 'NETWORK_AUTH_REQUIRED', exitCode: 2 });
  return value;
}

function baseUrl(options) {
  invariant(options.url, '--url is required', { code: 'INVALID_ARGUMENT' });
  const url = new URL(String(options.url));
  invariant(!url.username && !url.password, 'Carrier URL must not contain embedded credentials', { code: 'INSECURE_TRANSPORT', exitCode: 2 });
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  invariant(url.protocol === 'https:' || (loopback && url.protocol === 'http:'), 'Remote secure transport requires HTTPS; HTTP is allowed only for loopback tests', { code: 'INSECURE_TRANSPORT', exitCode: 2 });
  return url.toString().replace(/\/$/, '');
}

function endpoint(options, project, device, kind, id = null) {
  const suffix = id ? `/${encodeURIComponent(id)}` : '';
  return `${baseUrl(options)}/v1/projects/${encodeURIComponent(project)}/devices/${encodeURIComponent(device)}/${kind}${suffix}`;
}

async function requestJson(url, options, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${token(options)}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  invariant(response.ok, `Secure network carrier returned HTTP ${response.status}`, {
    code: 'NETWORK_TRANSPORT_FAILED', exitCode: 3, details: { url, status: response.status },
  });
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

export async function pushSecureNetworkEnvelope(input, id, options = {}) {
  const repo = repository(input);
  const hit = findSecureEnvelope(repo, id);
  invariant(hit, `Secure envelope not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const url = endpoint(options, projectId(repo), hit.envelope.recipient.device_id, 'messages', id);
  const carrier = await requestJson(url, options, { method: 'PUT', body: JSON.stringify(hit.envelope) });
  return { ok: true, status: 'REMOTE_AVAILABLE', secure_envelope_id: id, fingerprint: hit.envelope.integrity.digest, encrypted: true, identity_assurance: 'device-key-pair', carrier };
}

export async function sendSecureNetworkEnvelope(input, eventId, options = {}) {
  const prepared = prepareSecureEnvelope(input, eventId, options);
  return { ...(await pushSecureNetworkEnvelope(input, prepared.id, options)), event_id: eventId };
}

function staging(repo) {
  const directory = path.join(repo.paths.secure, '..', 'tmp', 'network', crypto.randomUUID());
  ensureDirectory(directory);
  return directory;
}

export async function receiveSecureNetworkEnvelopes(input, options = {}) {
  const repo = repository(input);
  const receiver = String(options['as-device'] || '');
  invariant(receiver, '--as-device is required', { code: 'INVALID_ARGUMENT' });
  const response = await requestJson(endpoint(options, projectId(repo), receiver, 'messages'), options);
  const items = Array.isArray(response.items) ? response.items : [];
  const expired = items.filter((item) => {
    const expiresAt = Date.parse(item?.delivery?.expires_at || '');
    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  });
  const available = items.filter((item) => !expired.includes(item));
  const temporary = staging(repo);
  try {
    const messageDir = path.join(temporary, 'v2', safeSegment(projectId(repo)), safeSegment(receiver), 'messages');
    ensureDirectory(messageDir);
    for (const envelope of available) writeJsonExclusive(path.join(messageDir, `${envelope.id}.json`), envelope);
    const result = receiveSecureEnvelopes(input, { ...options, channel: temporary });
    const receiptDir = path.join(temporary, 'v2', safeSegment(projectId(repo)));
    for (const file of walkJson(receiptDir).filter((entry) => entry.includes(`${path.sep}receipts${path.sep}`))) {
      const receipt = readJson(file);
      const original = available.find((item) => item.id === receipt.envelope.id);
      invariant(original?.sender?.device_id, `Cannot route receipt for secure envelope ${receipt.envelope.id}`, { code: 'NETWORK_TRANSPORT_FAILED', exitCode: 3 });
      await requestJson(endpoint(options, projectId(repo), original.sender.device_id, 'receipts', receipt.id), options, {
        method: 'PUT', body: JSON.stringify(receipt),
      });
    }
    return { ...result, expired: expired.map((item) => item.id), carrier: 'https-json-v1' };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export async function confirmSecureNetworkReceipts(input, options = {}) {
  const repo = repository(input);
  const sender = String(options['as-device'] || '');
  invariant(sender, '--as-device is required', { code: 'INVALID_ARGUMENT' });
  const response = await requestJson(endpoint(options, projectId(repo), sender, 'receipts'), options);
  const items = Array.isArray(response.items) ? response.items : [];
  const temporary = staging(repo);
  try {
    const receiptDir = path.join(temporary, 'v2', safeSegment(projectId(repo)), safeSegment(sender), 'receipts');
    ensureDirectory(receiptDir);
    for (const receipt of items) writeJsonExclusive(path.join(receiptDir, `${receipt.id}.json`), receipt);
    return { ...confirmSecureReceipts(input, { ...options, channel: temporary }), carrier: 'https-json-v1' };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
