import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invariant } from './errors.mjs';
import { ensureDirectory, isWithin, makeId, now, readJson, relativeUnix, walkJson, writeJsonExclusive } from './fs-utils.mjs';
import { seal, verifySeal } from './integrity.mjs';
import { preflightWrite } from './preflight.mjs';
import { projectId, repository } from './state.mjs';

function assertIdentityProtocol(repo) {
  invariant(repo.manifest.protocol_version === '1.4.0', `Device identities require protocol 1.4.0; current project is ${repo.manifest.protocol_version}. Run \`ahp project upgrade --plan\`.`, {
    code: 'PROTOCOL_UPGRADE_REQUIRED', exitCode: 2,
  });
}

function identityStore(options = {}) {
  if (options.store) return path.resolve(String(options.store));
  const base = process.platform === 'win32'
    ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'ahp-plus', 'identities');
}

function privateFile(repo, id, options = {}) {
  const file = options['private-file']
    ? path.resolve(String(options['private-file']))
    : path.join(identityStore(options), projectId(repo), `${id}.private.json`);
  invariant(!isWithin(repo.repoRoot, file), 'Private device identities must be stored outside the Git repository', {
    code: 'PRIVATE_KEY_IN_PROJECT', exitCode: 2, details: { private_file: file },
  });
  return file;
}

function publicIdentities(repo) {
  return walkJson(repo.paths.identitiesDevices).map((file) => ({ file, identity: readJson(file) }));
}

export function findDeviceIdentity(repoOrInput, id) {
  const repo = typeof repoOrInput === 'string' ? repository(repoOrInput) : repoOrInput;
  return publicIdentities(repo).find((item) => item.identity.id === id) || null;
}

function writePrivateIdentity(repo, file, value) {
  ensureDirectory(path.dirname(file));
  const actual = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  invariant(!isWithin(fs.realpathSync(repo.repoRoot), actual), 'Private device identities must resolve outside the Git repository', {
    code: 'PRIVATE_KEY_IN_PROJECT', exitCode: 2, details: { private_file: file },
  });
  if (process.platform !== 'win32') fs.chmodSync(path.dirname(file), 0o700);
  invariant(!fs.existsSync(file), `Private identity already exists: ${file}`, { code: 'COLLISION', exitCode: 2 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

function keyId(publicJwk) {
  return crypto.createHash('sha256').update(JSON.stringify(publicJwk)).digest('hex').slice(0, 32);
}

export function createDeviceIdentity(input = '.', options = {}) {
  const name = String(options.name || options.device || '').trim();
  invariant(name, '--name is required for device identity creation', { code: 'INVALID_ARGUMENT' });
  const platform = String(options.platform || 'unknown').trim();
  const { repo } = preflightWrite(input, { ...options, actor: options.actor || name }, 'identity:create');
  assertIdentityProtocol(repo);
  const id = makeId('DEV');
  const signing = crypto.generateKeyPairSync('ed25519');
  const encryption = crypto.generateKeyPairSync('x25519');
  const signingPublic = signing.publicKey.export({ format: 'jwk' });
  const encryptionPublic = encryption.publicKey.export({ format: 'jwk' });
  const createdAt = now();
  const publicIdentity = seal({
    schema_version: repo.manifest.protocol_version,
    id,
    kind: 'device_identity',
    project_id: projectId(repo),
    name,
    platform,
    assurance: 'device-key-pair',
    status: 'ACTIVE',
    keys: {
      signing: { algorithm: 'ed25519', key_id: `ed25519:${keyId(signingPublic)}`, public_jwk: signingPublic },
      encryption: { algorithm: 'x25519', key_id: `x25519:${keyId(encryptionPublic)}`, public_jwk: encryptionPublic },
    },
    created_at: createdAt,
  });
  const publicFile = path.join(repo.paths.identitiesDevices, `${id}.json`);
  const secretFile = privateFile(repo, id, options);
  writePrivateIdentity(repo, secretFile, {
    schema_version: '1.0.0',
    kind: 'device_private_identity',
    project_id: projectId(repo),
    device_id: id,
    signing_private_jwk: signing.privateKey.export({ format: 'jwk' }),
    encryption_private_jwk: encryption.privateKey.export({ format: 'jwk' }),
    created_at: createdAt,
  });
  try {
    writeJsonExclusive(publicFile, publicIdentity);
  } catch (error) {
    if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);
    throw error;
  }
  return {
    ok: true,
    status: 'IDENTITY_CREATED',
    device_id: id,
    assurance: publicIdentity.assurance,
    signing_key_id: publicIdentity.keys.signing.key_id,
    encryption_key_id: publicIdentity.keys.encryption.key_id,
    public_file: relativeUnix(repo.repoRoot, publicFile),
    private_file: secretFile,
    private_persisted_in_project: false,
    fingerprint: publicIdentity.integrity.digest,
  };
}

export function inspectDeviceIdentity(input, id) {
  const repo = repository(input);
  const hit = findDeviceIdentity(repo, id);
  invariant(hit, `Device identity not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  return {
    ok: verifySeal(hit.identity),
    device_id: id,
    fingerprint: hit.identity.integrity?.digest || null,
    integrity_valid: verifySeal(hit.identity),
    assurance: hit.identity.assurance,
    status: hit.identity.status,
    file: relativeUnix(repo.repoRoot, hit.file),
    identity: hit.identity,
  };
}

export function listDeviceIdentities(input = '.') {
  const repo = repository(input);
  const identities = publicIdentities(repo).map(({ identity }) => ({
    device_id: identity.id,
    name: identity.name,
    platform: identity.platform,
    status: identity.status,
    assurance: identity.assurance,
    fingerprint: identity.integrity?.digest || null,
  }));
  return { ok: true, project_id: projectId(repo), count: identities.length, identities };
}

export function loadPrivateDeviceIdentity(repoOrInput, id, options = {}) {
  const repo = typeof repoOrInput === 'string' ? repository(repoOrInput) : repoOrInput;
  const hit = findDeviceIdentity(repo, id);
  invariant(hit && verifySeal(hit.identity), `Public device identity is missing or invalid: ${id}`, { code: 'IDENTITY_INVALID', exitCode: 3 });
  const file = privateFile(repo, id, options);
  invariant(fs.existsSync(file), `Private identity unavailable for ${id}`, {
    code: 'IDENTITY_PRIVATE_KEY_REQUIRED', exitCode: 2, details: { private_file: file },
  });
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'Private identity must be a regular non-symlink file', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  invariant(!isWithin(fs.realpathSync(repo.repoRoot), fs.realpathSync(file)), 'Private device identities must be stored outside the Git repository', {
    code: 'PRIVATE_KEY_IN_PROJECT', exitCode: 2, details: { private_file: file },
  });
  if (process.platform !== 'win32') {
    invariant((stat.mode & 0o077) === 0, 'Private identity permissions are unsafe; expected chmod 600', { code: 'UNSAFE_SECRET_FILE', exitCode: 2 });
  }
  const secret = readJson(file);
  invariant(secret.project_id === projectId(repo) && secret.device_id === id, 'Private identity project or device mismatch', {
    code: 'IDENTITY_SCOPE_MISMATCH', exitCode: 3,
  });
  return { publicIdentity: hit.identity, privateIdentity: secret, privateFile: file };
}
