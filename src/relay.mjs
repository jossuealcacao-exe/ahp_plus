import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256 } from './canonical-json.mjs';
import { ID_PREFIXES, RELAY_RECEIPT_OUTCOMES } from './constants.mjs';
import { invariant } from './errors.mjs';
import { findContinuityEvent, inspectContinuityEvent } from './events.mjs';
import {
  makeId,
  now,
  readJson,
  relativeUnix,
  safeSegment,
  walkJson,
  writeJsonAtomic,
  writeJsonExclusive,
} from './fs-utils.mjs';
import { seal, verifySeal } from './integrity.mjs';
import { preflightWrite } from './preflight.mjs';
import { projectId, repository } from './state.mjs';

const RELAY_PROTOCOL_VERSIONS = Object.freeze(['1.3.0', '1.4.0']);
const DEFAULT_SECRET_ENV = 'AHP_RELAY_SECRET';
const DEFAULT_SECRET_FILE_ENV = 'AHP_RELAY_SECRET_FILE';
const DEFAULT_TTL_SECONDS = 300;

function assertRelayProtocol(repo) {
  invariant(RELAY_PROTOCOL_VERSIONS.includes(repo.manifest.protocol_version),
    `Relay operations require protocol 1.3.0 or newer; current project is ${repo.manifest.protocol_version}. Run \`ahp project upgrade --plan\`.`, {
      code: 'PROTOCOL_UPGRADE_REQUIRED',
      exitCode: 2,
      details: { current: repo.manifest.protocol_version, required: RELAY_PROTOCOL_VERSIONS },
    });
}

function relaySecret(options = {}) {
  const envName = String(options['secret-env'] || DEFAULT_SECRET_ENV);
  invariant(/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName), 'Invalid --secret-env name', { code: 'INVALID_ARGUMENT' });
  invariant(!(options['secret-file'] && options['secret-env']),
    'Use either --secret-file or --secret-env, not both', { code: 'INVALID_ARGUMENT' });
  const requestedFile = options['secret-file'] || (!process.env[envName] ? process.env[DEFAULT_SECRET_FILE_ENV] : null);
  let secret = process.env[envName];
  let source = { type: 'environment', name: envName };
  if (requestedFile) {
    const file = path.resolve(String(requestedFile));
    invariant(fs.existsSync(file), `Relay secret file does not exist: ${file}`, {
      code: 'RELAY_AUTH_REQUIRED', exitCode: 2, details: { secret_file: file },
    });
    const stat = fs.lstatSync(file);
    invariant(stat.isFile() && !stat.isSymbolicLink(), 'Relay secret file must be a regular non-symlink file', {
      code: 'RELAY_SECRET_FILE_UNSAFE', exitCode: 2, details: { secret_file: file },
    });
    invariant(stat.size <= 4096, 'Relay secret file exceeds 4096 bytes', {
      code: 'RELAY_SECRET_FILE_UNSAFE', exitCode: 2, details: { secret_file: file },
    });
    if (process.platform !== 'win32') {
      invariant((stat.mode & 0o077) === 0, 'Relay secret file must not be accessible by group or others; use chmod 600', {
        code: 'RELAY_SECRET_FILE_UNSAFE', exitCode: 2, details: { secret_file: file, mode: (stat.mode & 0o777).toString(8) },
      });
    }
    secret = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    source = { type: 'file', path: file };
  }
  invariant(typeof secret === 'string' && Buffer.byteLength(secret) >= 32,
    `Relay authentication requires at least 32 bytes from ${requestedFile ? '--secret-file' : envName}. The secret is read at execution time and is never persisted by AHP+.`, {
      code: 'RELAY_AUTH_REQUIRED', exitCode: 2,
      details: { secret_source: source.type, secret_env: requestedFile ? null : envName, minimum_bytes: 32 },
    });
  return { source, secret };
}

function keyId(secret) {
  return `hmac:${sha256(secret).slice(0, 24)}`;
}

function authenticationPayload(value) {
  const payload = structuredClone(value);
  delete payload.integrity;
  payload.authentication = { ...payload.authentication, signature: null };
  return canonicalJson(payload);
}

function signatureFor(value, secret) {
  return crypto.createHmac('sha256', secret).update(authenticationPayload(value)).digest('hex');
}

function authenticated(value, secret) {
  const unsigned = {
    ...value,
    authentication: {
      scheme: 'hmac-sha256',
      key_id: keyId(secret),
      credential_scope: 'project-shared-secret',
      signature: null,
    },
  };
  unsigned.authentication.signature = signatureFor(unsigned, secret);
  return seal(unsigned);
}

function authenticationValid(value, secret) {
  if (value?.authentication?.scheme !== 'hmac-sha256') return false;
  if (value.authentication.key_id !== keyId(secret)) return false;
  const actual = String(value.authentication.signature || '');
  const expected = signatureFor(value, secret);
  if (!/^[a-f0-9]{64}$/.test(actual)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function channelRoot(options = {}) {
  invariant(options.channel, '--channel is required for relay transport', { code: 'INVALID_ARGUMENT' });
  return path.resolve(String(options.channel));
}

function channelProjectRoot(repo, options) {
  return path.join(channelRoot(options), 'v1', safeSegment(projectId(repo)));
}

function ttlSeconds(options = {}) {
  const value = Number(options.ttl || DEFAULT_TTL_SECONDS);
  invariant(Number.isFinite(value) && value >= 1 && value <= 86400,
    '--ttl must be between 1 and 86400 seconds', { code: 'INVALID_ARGUMENT', details: { ttl: options.ttl } });
  return value;
}

function relayFiles(repo) {
  return [...walkJson(repo.paths.relayOutbox), ...walkJson(repo.paths.relayInbox)];
}

function findRelayEnvelope(repo, id) {
  for (const file of relayFiles(repo)) {
    const envelope = readJson(file);
    if (envelope.id === id) return { file, envelope };
  }
  return null;
}

function findRelayReceipt(repo, id) {
  for (const file of walkJson(repo.paths.relayReceipts)) {
    const receipt = readJson(file);
    if (receipt.id === id) return { file, receipt };
  }
  return null;
}

function receiptForEnvelope(repo, envelopeId) {
  for (const file of walkJson(repo.paths.relayReceipts)) {
    const receipt = readJson(file);
    if (receipt.envelope?.id === envelopeId && receipt.outcome === 'RECEIVED') return { file, receipt };
  }
  return null;
}

function envelopeChecks(envelope, secret) {
  const integrityValid = verifySeal(envelope);
  const authenticationIsValid = authenticationValid(envelope, secret);
  const eventIntegrityValid = verifySeal(envelope?.payload)
    && envelope?.payload?.id === envelope?.message?.event_id
    && envelope?.payload?.integrity?.digest === envelope?.message?.event_fingerprint;
  const expiresAt = Date.parse(envelope?.delivery?.expires_at || '');
  const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  return {
    ok: integrityValid && authenticationIsValid && eventIntegrityValid && !expired,
    integrity_valid: integrityValid,
    authentication_valid: authenticationIsValid,
    event_integrity_valid: eventIntegrityValid,
    expired,
  };
}

function receiptChecks(receipt, secret) {
  return {
    integrity_valid: verifySeal(receipt),
    authentication_valid: authenticationValid(receipt, secret),
    outcome_valid: RELAY_RECEIPT_OUTCOMES.includes(receipt?.outcome),
  };
}

function writeIdempotent(file, value, kind) {
  if (!fs.existsSync(file)) {
    writeJsonExclusive(file, value);
    return { written: true, duplicate: false };
  }
  const existing = readJson(file);
  invariant(existing?.integrity?.digest === value?.integrity?.digest,
    `${kind} collision at ${file}`, {
      code: 'RELAY_CONFLICT', exitCode: 3,
      details: { file, existing_fingerprint: existing?.integrity?.digest, incoming_fingerprint: value?.integrity?.digest },
    });
  return { written: false, duplicate: true };
}

export function prepareRelayEnvelope(input, eventId, options = {}) {
  const { repo } = preflightWrite(input, options, 'relay:prepare');
  assertRelayProtocol(repo);
  const { secret } = relaySecret(options);
  const inspected = inspectContinuityEvent(input, eventId);
  invariant(inspected.ok, `Cannot relay invalid event ${eventId}`, { code: 'INTEGRITY_ERROR', exitCode: 3 });
  const event = findContinuityEvent(repo, eventId).event;
  invariant(event.to, `Event ${eventId} has no destination. Directed relay messages require --to.`, { code: 'INVALID_ARGUMENT' });
  const createdAt = now();
  const ttl = ttlSeconds(options);
  const id = makeId(ID_PREFIXES.relay_envelope);
  const envelope = authenticated({
    schema_version: repo.manifest.protocol_version,
    id,
    kind: 'relay_envelope',
    project_id: projectId(repo),
    provider: String(options.provider || 'file-reference'),
    message: {
      event_id: event.id,
      event_fingerprint: event.integrity.digest,
      session_id: event.session_id,
      correlation_id: event.correlation_id,
      sequence: event.sequence,
      from: event.from,
      to: event.to,
    },
    delivery: {
      state: 'SYNC_PENDING',
      attempt_id: crypto.randomUUID(),
      nonce: crypto.randomBytes(16).toString('hex'),
      created_at: createdAt,
      expires_at: new Date(Date.parse(createdAt) + ttl * 1000).toISOString(),
    },
    payload: event,
    created_at: createdAt,
  }, secret);
  const file = path.join(repo.paths.relayOutbox, `${id}.json`);
  writeJsonExclusive(file, envelope);
  return { ...envelope, fingerprint: envelope.integrity.digest, file: relativeUnix(repo.repoRoot, file) };
}

export function inspectRelayEnvelope(input, id, options = {}) {
  const repo = repository(input);
  const hit = findRelayEnvelope(repo, id);
  invariant(hit, `Relay envelope not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const { secret } = relaySecret(options);
  const checks = envelopeChecks(hit.envelope, secret);
  return {
    ...checks,
    envelope_id: id,
    fingerprint: hit.envelope.integrity?.digest || null,
    event_id: hit.envelope.message?.event_id || null,
    event_fingerprint: hit.envelope.message?.event_fingerprint || null,
    file: relativeUnix(repo.repoRoot, hit.file),
    envelope: hit.envelope,
  };
}

export function pushRelayEnvelope(input, id, options = {}) {
  const repo = repository(input);
  assertRelayProtocol(repo);
  const hit = findRelayEnvelope(repo, id);
  invariant(hit, `Relay envelope not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const { secret } = relaySecret(options);
  invariant(hit.envelope.provider === 'file-reference',
    `Core file-channel push cannot publish provider ${hit.envelope.provider}; prepare with --provider file-reference or use that provider's adapter.`, {
      code: 'RELAY_PROVIDER_MISMATCH', exitCode: 2,
    });
  const checks = envelopeChecks(hit.envelope, secret);
  invariant(checks.ok, `Relay envelope ${id} failed integrity, authentication, payload, or expiry checks`, {
    code: checks.expired ? 'RELAY_EXPIRED' : 'RELAY_INVALID', exitCode: 3, details: checks,
  });
  const destination = safeSegment(hit.envelope.message.to);
  const file = path.join(channelProjectRoot(repo, options), destination, 'messages', `${id}.json`);
  const result = writeIdempotent(file, hit.envelope, 'relay envelope');
  const cacheFile = path.join(repo.stateRoot, 'cache/relay/push', `${id}.json`);
  writeJsonAtomic(cacheFile, {
    envelope_id: id,
    envelope_fingerprint: hit.envelope.integrity.digest,
    channel_id: sha256(channelRoot(options)).slice(0, 24),
    status: 'REMOTE_AVAILABLE',
    observed_at: now(),
  });
  return {
    ok: true,
    status: 'REMOTE_AVAILABLE',
    envelope_id: id,
    fingerprint: hit.envelope.integrity.digest,
    destination: hit.envelope.message.to,
    channel_file: file,
    idempotent_duplicate: result.duplicate,
  };
}

function validateIncoming(repo, envelope, destination, secret) {
  const checks = envelopeChecks(envelope, secret);
  invariant(checks.ok, `Incoming relay envelope ${envelope?.id || 'unknown'} failed integrity, authentication, payload, or expiry checks`, {
    code: checks.expired ? 'RELAY_EXPIRED' : 'RELAY_INVALID', exitCode: 3, details: checks,
  });
  invariant(RELAY_PROTOCOL_VERSIONS.includes(envelope.schema_version), `Unsupported relay schema ${envelope.schema_version}`, { code: 'UNSUPPORTED_PROTOCOL', exitCode: 2 });
  invariant(envelope.project_id === projectId(repo), `Relay project ${envelope.project_id} does not match ${projectId(repo)}`, { code: 'PROJECT_SCOPE_MISMATCH', exitCode: 2 });
  invariant(envelope.message.to === destination, `Relay destination ${envelope.message.to} does not match receiver ${destination}`, { code: 'RECEIVER_MISMATCH', exitCode: 3 });
  const event = envelope.payload;
  invariant(event.project_id === projectId(repo), 'Relay payload project mismatch', { code: 'PROJECT_SCOPE_MISMATCH', exitCode: 2 });
  if (event.causal?.parent_event_id) {
    const parent = findContinuityEvent(repo, event.causal.parent_event_id)?.event || null;
    invariant(parent && parent.integrity?.digest === event.causal.parent_fingerprint,
      `Missing or mismatched causal parent ${event.causal.parent_event_id}`, {
        code: 'MISSING_CAUSAL_PARENT', exitCode: 3,
        details: { parent_event_id: event.causal.parent_event_id, parent_fingerprint: event.causal.parent_fingerprint },
      });
  }
}

function createReceipt(repo, envelope, destination, channel, options, secret) {
  const existing = receiptForEnvelope(repo, envelope.id);
  if (existing) return { receipt: existing.receipt, file: existing.file, duplicate: true };
  const receivedAt = now();
  const id = makeId(ID_PREFIXES.relay_receipt);
  const receipt = authenticated({
    schema_version: repo.manifest.protocol_version,
    id,
    kind: 'relay_receipt',
    project_id: projectId(repo),
    envelope: {
      id: envelope.id,
      fingerprint: envelope.integrity.digest,
    },
    message: {
      event_id: envelope.message.event_id,
      event_fingerprint: envelope.message.event_fingerprint,
      session_id: envelope.message.session_id,
      from: envelope.message.from,
      to: envelope.message.to,
    },
    receiver: {
      platform: destination,
      actor: String(options.actor || 'AI agent'),
      model: String(options.model || 'unknown'),
    },
    outcome: 'RECEIVED',
    transport: {
      provider: String(envelope.provider || 'file-reference'),
      channel_id: sha256(channel).slice(0, 24),
    },
    received_at: receivedAt,
    created_at: receivedAt,
  }, secret);
  const file = path.join(repo.paths.relayReceipts, `${id}.json`);
  writeJsonExclusive(file, receipt);
  return { receipt, file, duplicate: false };
}

function publishReceiptToChannel(repo, receipt, options) {
  const destination = safeSegment(receipt.message.from);
  const file = path.join(channelProjectRoot(repo, options), destination, 'receipts', `${receipt.id}.json`);
  const result = writeIdempotent(file, receipt, 'relay receipt');
  return { file, ...result };
}

export function pullRelayMessages(input, options = {}) {
  const { repo } = preflightWrite(input, options, 'relay:pull');
  assertRelayProtocol(repo);
  const destination = String(options.for || options.to || options.as || '');
  invariant(destination, '--for or --as is required for relay pull', { code: 'INVALID_ARGUMENT' });
  const { secret } = relaySecret(options);
  const channel = channelRoot(options);
  const directory = path.join(channelProjectRoot(repo, options), safeSegment(destination), 'messages');
  const received = [];
  const duplicates = [];
  const pending = walkJson(directory).map((sourceFile) => ({ sourceFile, envelope: readJson(sourceFile) }));
  const ordered = [];
  while (pending.length) {
    const readyIndex = pending.findIndex(({ envelope }) => {
      const parentId = envelope.payload?.causal?.parent_event_id;
      if (!parentId || findContinuityEvent(repo, parentId)) return true;
      return !pending.some((candidate) => candidate.envelope.payload?.id === parentId);
    });
    invariant(readyIndex >= 0, 'Relay batch contains a causal cycle', { code: 'RELAY_CONFLICT', exitCode: 3 });
    ordered.push(pending.splice(readyIndex, 1)[0]);
  }
  for (const { envelope } of ordered) {
    validateIncoming(repo, envelope, destination, secret);
    const inboxFile = path.join(repo.paths.relayInbox, `${envelope.id}.json`);
    const existingEnvelope = fs.existsSync(inboxFile) ? readJson(inboxFile) : null;
    if (existingEnvelope) {
      invariant(existingEnvelope.integrity?.digest === envelope.integrity?.digest,
        `Relay inbox collision for ${envelope.id}`, { code: 'RELAY_CONFLICT', exitCode: 3 });
    }
    const event = envelope.payload;
    const eventFile = path.join(repo.paths.events, safeSegment(event.session_id), `${event.id}.json`);
    const existingEventHit = findContinuityEvent(repo, event.id);
    if (existingEventHit) {
      const existingEvent = existingEventHit.event;
      invariant(existingEvent.integrity?.digest === event.integrity?.digest,
        `Continuity event collision for ${event.id}`, { code: 'RELAY_CONFLICT', exitCode: 3 });
    } else {
      const sessionEvents = walkJson(path.join(repo.paths.events, safeSegment(event.session_id)))
        .map((file) => readJson(file));
      const expectedSequence = sessionEvents.length
        ? Math.max(...sessionEvents.map((candidate) => Number(candidate.sequence))) + 1
        : 1;
      invariant(event.sequence === expectedSequence,
        `Relay event ${event.id} creates a session sequence gap; expected ${expectedSequence}, found ${event.sequence}`, {
          code: 'MISSING_CAUSAL_HISTORY', exitCode: 3,
          details: { session_id: event.session_id, expected_sequence: expectedSequence, event_sequence: event.sequence },
        });
    }
    if (!existingEnvelope) writeJsonExclusive(inboxFile, envelope);
    if (!existingEventHit) writeJsonExclusive(eventFile, event);
    const receiptResult = createReceipt(repo, envelope, destination, channel, options, secret);
    publishReceiptToChannel(repo, receiptResult.receipt, options);
    const item = {
      envelope_id: envelope.id,
      envelope_fingerprint: envelope.integrity.digest,
      event_id: event.id,
      event_fingerprint: event.integrity.digest,
      receipt_id: receiptResult.receipt.id,
      receipt_fingerprint: receiptResult.receipt.integrity.digest,
    };
    if (existingEnvelope || receiptResult.duplicate) duplicates.push(item);
    else received.push(item);
  }
  return {
    ok: true,
    status: received.length ? 'RECEIVED' : 'NO_NEW_MESSAGES',
    project_id: projectId(repo),
    receiver: destination,
    count: received.length,
    received,
    duplicates,
  };
}

export async function watchRelayMessages(input, options = {}) {
  const timeout = Number(options.timeout || 30);
  const interval = Number(options.interval || 500);
  invariant(Number.isFinite(timeout) && timeout >= 0 && timeout <= 300, '--timeout must be between 0 and 300 seconds', { code: 'INVALID_ARGUMENT' });
  invariant(Number.isFinite(interval) && interval >= 50 && interval <= 10000, '--interval must be between 50 and 10000 milliseconds', { code: 'INVALID_ARGUMENT' });
  const started = Date.now();
  do {
    const result = pullRelayMessages(input, options);
    if (result.count > 0) return { ...result, watch: 'MESSAGE_AVAILABLE', waited_ms: Date.now() - started };
    if (Date.now() - started >= timeout * 1000) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (true);
  return {
    ok: true,
    status: 'TIMEOUT',
    watch: 'NO_NEW_MESSAGES',
    receiver: options.for || options.to || options.as,
    waited_ms: Date.now() - started,
    count: 0,
    received: [],
  };
}

export function syncRelayReceipts(input, options = {}) {
  const { repo } = preflightWrite(input, options, 'relay:receipts');
  assertRelayProtocol(repo);
  const destination = String(options.for || options.as || '');
  invariant(destination, '--for or --as is required for relay receipts', { code: 'INVALID_ARGUMENT' });
  const { secret } = relaySecret(options);
  const directory = path.join(channelProjectRoot(repo, options), safeSegment(destination), 'receipts');
  const imported = [];
  const duplicates = [];
  for (const sourceFile of walkJson(directory)) {
    const receipt = readJson(sourceFile);
    const checks = receiptChecks(receipt, secret);
    invariant(checks.integrity_valid && checks.authentication_valid && checks.outcome_valid,
      `Relay receipt ${receipt?.id || 'unknown'} failed validation`, { code: 'RELAY_RECEIPT_INVALID', exitCode: 3, details: checks });
    invariant(receipt.project_id === projectId(repo), 'Relay receipt project mismatch', { code: 'PROJECT_SCOPE_MISMATCH', exitCode: 2 });
    invariant(receipt.message.from === destination, `Receipt return destination ${receipt.message.from} does not match ${destination}`, { code: 'RECEIVER_MISMATCH', exitCode: 3 });
    const envelopeHit = findRelayEnvelope(repo, receipt.envelope.id);
    invariant(envelopeHit && envelopeHit.envelope.integrity.digest === receipt.envelope.fingerprint,
      `Receipt references unknown or mismatched envelope ${receipt.envelope.id}`, { code: 'RELAY_RECEIPT_INVALID', exitCode: 3 });
    invariant(envelopeHit.envelope.message.event_id === receipt.message.event_id
      && envelopeHit.envelope.message.event_fingerprint === receipt.message.event_fingerprint
      && envelopeHit.envelope.message.from === receipt.message.from
      && envelopeHit.envelope.message.to === receipt.message.to
      && envelopeHit.envelope.message.to === receipt.receiver.platform,
    `Receipt ${receipt.id} route or message does not match envelope ${receipt.envelope.id}`, {
      code: 'RELAY_RECEIPT_INVALID', exitCode: 3,
    });
    const file = path.join(repo.paths.relayReceipts, `${receipt.id}.json`);
    const result = writeIdempotent(file, receipt, 'relay receipt');
    const item = {
      receipt_id: receipt.id,
      receipt_fingerprint: receipt.integrity.digest,
      envelope_id: receipt.envelope.id,
      event_id: receipt.message.event_id,
      outcome: receipt.outcome,
      receiver: receipt.receiver.platform,
    };
    if (result.duplicate) duplicates.push(item);
    else imported.push(item);
  }
  return { ok: true, project_id: projectId(repo), for: destination, count: imported.length, imported, duplicates };
}

export function inspectRelayReceipt(input, id, options = {}) {
  const repo = repository(input);
  const hit = findRelayReceipt(repo, id);
  invariant(hit, `Relay receipt not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const { secret } = relaySecret(options);
  const checks = receiptChecks(hit.receipt, secret);
  const envelopeHit = findRelayEnvelope(repo, hit.receipt.envelope?.id);
  const envelopeMatches = Boolean(envelopeHit
    && envelopeHit.envelope.integrity?.digest === hit.receipt.envelope?.fingerprint
    && envelopeHit.envelope.message?.event_fingerprint === hit.receipt.message?.event_fingerprint);
  const receiverMatchesDestination = Boolean(envelopeHit
    && hit.receipt.receiver?.platform === envelopeHit.envelope.message?.to
    && hit.receipt.message?.from === envelopeHit.envelope.message?.from);
  const ok = checks.integrity_valid
    && checks.authentication_valid
    && checks.outcome_valid
    && envelopeMatches
    && receiverMatchesDestination;
  return {
    ok,
    receipt_id: id,
    fingerprint: hit.receipt.integrity?.digest || null,
    ...checks,
    envelope_matches: envelopeMatches,
    receiver_matches_destination: receiverMatchesDestination,
    identity_assurance: 'project-shared-secret',
    delivery_confirmed: ok && hit.receipt.outcome === 'RECEIVED',
    file: relativeUnix(repo.repoRoot, hit.file),
    receipt: hit.receipt,
  };
}

export function listRelayReceipts(input = '.', options = {}) {
  const repo = repository(input);
  let receipts = walkJson(repo.paths.relayReceipts).map((file) => readJson(file));
  if (options.outcome) receipts = receipts.filter((receipt) => receipt.outcome === String(options.outcome).toUpperCase());
  const participant = options.for || options.as;
  if (participant) receipts = receipts.filter((receipt) => receipt.message?.from === participant || receipt.receiver?.platform === participant);
  const limit = Number(options.limit || 0);
  if (limit > 0) receipts = receipts.slice(-limit);
  return {
    project_id: projectId(repo),
    count: receipts.length,
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      fingerprint: receipt.integrity?.digest || null,
      envelope_id: receipt.envelope?.id || null,
      event_id: receipt.message?.event_id || null,
      outcome: receipt.outcome,
      receiver: receipt.receiver?.platform || null,
      received_at: receipt.received_at,
    })),
  };
}
