import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './canonical-json.mjs';
import { findContinuityEvent } from './events.mjs';
import { invariant } from './errors.mjs';
import { makeId, now, readJson, relativeUnix, safeSegment, walkJson, writeJsonExclusive } from './fs-utils.mjs';
import { seal, verifySeal } from './integrity.mjs';
import { findDeviceIdentity, loadPrivateDeviceIdentity } from './identity.mjs';
import { preflightWrite } from './preflight.mjs';
import { projectId, repository } from './state.mjs';

function assertSecureProtocol(repo) {
  invariant(repo.manifest.protocol_version === '1.4.0', `Secure relay requires protocol 1.4.0; current project is ${repo.manifest.protocol_version}. Run \`ahp project upgrade --plan\`.`, {
    code: 'PROTOCOL_UPGRADE_REQUIRED', exitCode: 2,
  });
}

function signaturePayload(value) {
  return canonicalJson({
    ...value,
    authentication: { ...value.authentication, signature: null },
    integrity: { ...value.integrity, digest: null },
  });
}

function signDocument(value, privateJwk) {
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const signature = crypto.sign(null, Buffer.from(signaturePayload(value)), privateKey).toString('base64');
  return seal({ ...value, authentication: { ...value.authentication, signature } });
}

function verifyDocumentSignature(value, publicJwk) {
  if (!verifySeal(value) || !value.authentication?.signature) return false;
  try {
    const publicKey = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
    return crypto.verify(
      null,
      Buffer.from(signaturePayload(value)),
      publicKey,
      Buffer.from(value.authentication.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function sharedKey(privateJwk, publicJwk, project, sender, recipient) {
  const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
  const publicKey = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
  const secret = crypto.diffieHellman({ privateKey, publicKey });
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    secret,
    Buffer.from(project),
    Buffer.from(`AHP+ secure relay v1\0${sender}\0${recipient}`),
    32,
  ));
}

function envelopeAad(value) {
  return canonicalJson({
    schema_version: value.schema_version,
    id: value.id,
    project_id: value.project_id,
    sender: value.sender,
    recipient: value.recipient,
    message: value.message,
    delivery: value.delivery,
  });
}

function channelRoot(repo, options) {
  invariant(options.channel, '--channel is required', { code: 'INVALID_ARGUMENT' });
  return path.join(path.resolve(String(options.channel)), 'v2', safeSegment(projectId(repo)));
}

function device(repo, id) {
  const hit = findDeviceIdentity(repo, id);
  invariant(hit && verifySeal(hit.identity), `Device identity not found or invalid: ${id}`, { code: 'IDENTITY_INVALID', exitCode: 3 });
  invariant(hit.identity.status === 'ACTIVE', `Device identity is not active: ${id}`, { code: 'IDENTITY_REVOKED', exitCode: 3 });
  return hit.identity;
}

export function findSecureEnvelope(repo, id) {
  return [...walkJson(repo.paths.secureOutbox), ...walkJson(repo.paths.secureInbox)]
    .map((file) => ({ file, envelope: readJson(file) }))
    .find((item) => item.envelope.id === id) || null;
}

export function findSecureReceipt(repo, id) {
  return walkJson(repo.paths.secureReceipts)
    .map((file) => ({ file, receipt: readJson(file) }))
    .find((item) => item.receipt.id === id) || null;
}

function writeIdempotent(file, value, label) {
  if (!fs.existsSync(file)) {
    writeJsonExclusive(file, value);
    return false;
  }
  const existing = readJson(file);
  invariant(existing.integrity?.digest === value.integrity?.digest, `${label} collision at ${file}`, { code: 'COLLISION', exitCode: 3 });
  return true;
}

function secureChecks(repo, envelope) {
  const sender = findDeviceIdentity(repo, envelope.sender?.device_id)?.identity || null;
  return {
    integrity_valid: verifySeal(envelope),
    sender_identity_valid: Boolean(sender && verifySeal(sender) && sender.status === 'ACTIVE'),
    signature_valid: Boolean(sender && verifyDocumentSignature(envelope, sender.keys?.signing?.public_jwk)),
    project_valid: envelope.project_id === projectId(repo),
    expiry_valid: Number.isFinite(Date.parse(envelope.delivery?.expires_at)) && Date.parse(envelope.delivery.expires_at) > Date.now(),
  };
}

export function prepareSecureEnvelope(input, eventId, options = {}) {
  const { repo } = preflightWrite(input, options, 'secure:prepare');
  assertSecureProtocol(repo);
  const senderId = String(options['from-device'] || '');
  const recipientId = String(options['to-device'] || '');
  invariant(senderId && recipientId, '--from-device and --to-device are required', { code: 'INVALID_ARGUMENT' });
  invariant(senderId !== recipientId, 'Secure sender and recipient devices must differ', { code: 'INVALID_ARGUMENT' });
  const senderSecret = loadPrivateDeviceIdentity(repo, senderId, options);
  const recipient = device(repo, recipientId);
  const eventHit = findContinuityEvent(repo, eventId);
  invariant(eventHit && verifySeal(eventHit.event), `Continuity event not found or invalid: ${eventId}`, { code: 'INTEGRITY_ERROR', exitCode: 3 });
  const id = makeId('SEC');
  const createdAt = now();
  const ttl = Number(options.ttl || 300);
  invariant(Number.isFinite(ttl) && ttl >= 30 && ttl <= 86400, '--ttl must be between 30 and 86400 seconds', { code: 'INVALID_ARGUMENT' });
  const value = {
    schema_version: repo.manifest.protocol_version,
    id,
    kind: 'secure_envelope',
    project_id: projectId(repo),
    identity_assurance: 'device-key-pair',
    sender: {
      device_id: senderId,
      identity_fingerprint: senderSecret.publicIdentity.integrity.digest,
      signing_key_id: senderSecret.publicIdentity.keys.signing.key_id,
      encryption_key_id: senderSecret.publicIdentity.keys.encryption.key_id,
    },
    recipient: {
      device_id: recipientId,
      identity_fingerprint: recipient.integrity.digest,
      encryption_key_id: recipient.keys.encryption.key_id,
    },
    message: {
      event_id: eventHit.event.id,
      event_fingerprint: eventHit.event.integrity.digest,
      session_id: eventHit.event.session_id,
      from: eventHit.event.from,
      to: eventHit.event.to,
    },
    delivery: {
      state: 'SYNC_PENDING',
      nonce: crypto.randomBytes(16).toString('hex'),
      created_at: createdAt,
      expires_at: new Date(Date.parse(createdAt) + ttl * 1000).toISOString(),
    },
    encryption: { algorithm: 'aes-256-gcm', key_agreement: 'x25519-hkdf-sha256', iv: null, tag: null },
    payload: { encoding: 'base64', ciphertext: null },
    created_at: createdAt,
    authentication: {
      scheme: 'ed25519',
      key_id: senderSecret.publicIdentity.keys.signing.key_id,
      credential_scope: 'device-key-pair',
      signature: null,
    },
    integrity: { algorithm: 'sha256', canonicalization: 'ahp-canonical-json-v1', digest: null },
  };
  const iv = crypto.randomBytes(12);
  const key = sharedKey(
    senderSecret.privateIdentity.encryption_private_jwk,
    recipient.keys.encryption.public_jwk,
    value.project_id,
    senderId,
    recipientId,
  );
  value.encryption.iv = iv.toString('base64');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(envelopeAad(value)));
  const ciphertext = Buffer.concat([cipher.update(canonicalJson(eventHit.event)), cipher.final()]);
  value.encryption.tag = cipher.getAuthTag().toString('base64');
  value.payload.ciphertext = ciphertext.toString('base64');
  const envelope = signDocument(value, senderSecret.privateIdentity.signing_private_jwk);
  const file = path.join(repo.paths.secureOutbox, `${id}.json`);
  writeJsonExclusive(file, envelope);
  return { ok: true, status: 'SECURE_PREPARED', id, fingerprint: envelope.integrity.digest, file: relativeUnix(repo.repoRoot, file), envelope };
}

export function pushSecureEnvelope(input, id, options = {}) {
  const repo = repository(input);
  const hit = findSecureEnvelope(repo, id);
  invariant(hit, `Secure envelope not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const checks = secureChecks(repo, hit.envelope);
  invariant(checks.integrity_valid && checks.sender_identity_valid && checks.signature_valid && checks.project_valid && checks.expiry_valid,
    `Secure envelope ${id} failed verification`, { code: 'SECURE_ENVELOPE_INVALID', exitCode: 3, details: checks });
  const file = path.join(channelRoot(repo, options), safeSegment(hit.envelope.recipient.device_id), 'messages', `${id}.json`);
  const duplicate = writeIdempotent(file, hit.envelope, 'secure channel envelope');
  return { ok: true, status: 'REMOTE_AVAILABLE', id, fingerprint: hit.envelope.integrity.digest, identity_assurance: 'device-key-pair', encrypted: true, idempotent_duplicate: duplicate, channel_file: file };
}

export function sendSecureEnvelope(input, eventId, options = {}) {
  const prepared = prepareSecureEnvelope(input, eventId, options);
  return { ...pushSecureEnvelope(input, prepared.id, options), event_id: eventId };
}

function decryptEnvelope(repo, envelope, receiverSecret) {
  const sender = device(repo, envelope.sender.device_id);
  const key = sharedKey(
    receiverSecret.privateIdentity.encryption_private_jwk,
    sender.keys.encryption.public_jwk,
    envelope.project_id,
    envelope.sender.device_id,
    envelope.recipient.device_id,
  );
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.encryption.iv, 'base64'));
  decipher.setAAD(Buffer.from(envelopeAad(envelope)));
  decipher.setAuthTag(Buffer.from(envelope.encryption.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

function createSecureReceipt(repo, envelope, receiverSecret, options) {
  const id = makeId('SRC');
  const createdAt = now();
  const value = {
    schema_version: repo.manifest.protocol_version,
    id,
    kind: 'secure_receipt',
    project_id: projectId(repo),
    identity_assurance: 'device-key-pair',
    envelope: { id: envelope.id, fingerprint: envelope.integrity.digest },
    message: envelope.message,
    receiver: {
      device_id: receiverSecret.publicIdentity.id,
      identity_fingerprint: receiverSecret.publicIdentity.integrity.digest,
      signing_key_id: receiverSecret.publicIdentity.keys.signing.key_id,
    },
    outcome: 'RECEIVED',
    received_at: createdAt,
    created_at: createdAt,
    authentication: {
      scheme: 'ed25519',
      key_id: receiverSecret.publicIdentity.keys.signing.key_id,
      credential_scope: 'device-key-pair',
      signature: null,
    },
    integrity: { algorithm: 'sha256', canonicalization: 'ahp-canonical-json-v1', digest: null },
  };
  const receipt = signDocument(value, receiverSecret.privateIdentity.signing_private_jwk);
  const local = path.join(repo.paths.secureReceipts, `${id}.json`);
  writeJsonExclusive(local, receipt);
  const channel = path.join(channelRoot(repo, options), safeSegment(envelope.sender.device_id), 'receipts', `${id}.json`);
  writeIdempotent(channel, receipt, 'secure channel receipt');
  return receipt;
}

export function receiveSecureEnvelopes(input, options = {}) {
  const { repo } = preflightWrite(input, options, 'secure:receive');
  assertSecureProtocol(repo);
  const receiverId = String(options['as-device'] || '');
  invariant(receiverId, '--as-device is required', { code: 'INVALID_ARGUMENT' });
  const receiverSecret = loadPrivateDeviceIdentity(repo, receiverId, options);
  const directory = path.join(channelRoot(repo, options), safeSegment(receiverId), 'messages');
  const received = [];
  const duplicates = [];
  for (const source of walkJson(directory)) {
    const envelope = readJson(source);
    const checks = secureChecks(repo, envelope);
    invariant(Object.values(checks).every(Boolean), `Secure envelope ${envelope.id || 'unknown'} failed verification`, { code: 'SECURE_ENVELOPE_INVALID', exitCode: 3, details: checks });
    invariant(envelope.recipient.device_id === receiverId, `Secure envelope recipient does not match ${receiverId}`, { code: 'RECEIVER_MISMATCH', exitCode: 3 });
    const event = decryptEnvelope(repo, envelope, receiverSecret);
    invariant(verifySeal(event) && event.id === envelope.message.event_id && event.integrity.digest === envelope.message.event_fingerprint,
      `Decrypted event does not match secure envelope ${envelope.id}`, { code: 'SECURE_PAYLOAD_INVALID', exitCode: 3 });
    const eventFile = path.join(repo.paths.events, safeSegment(event.session_id), `${event.id}.json`);
    const inboxFile = path.join(repo.paths.secureInbox, `${envelope.id}.json`);
    const inboxDuplicate = writeIdempotent(inboxFile, envelope, 'secure inbox envelope');
    const eventDuplicate = writeIdempotent(eventFile, event, 'secure event');
    const duplicate = inboxDuplicate || eventDuplicate;
    const existingReceipt = walkJson(repo.paths.secureReceipts).map((file) => readJson(file))
      .find((receipt) => receipt.envelope?.id === envelope.id && receipt.receiver?.device_id === receiverId);
    const receipt = existingReceipt || createSecureReceipt(repo, envelope, receiverSecret, options);
    const item = { envelope_id: envelope.id, event_id: event.id, event_fingerprint: event.integrity.digest, receipt_id: receipt.id, receipt_fingerprint: receipt.integrity.digest };
    (duplicate || existingReceipt ? duplicates : received).push(item);
  }
  return { ok: true, status: received.length ? 'RECEIVED' : 'NO_NEW_MESSAGES', receiver_device_id: receiverId, identity_assurance: 'device-key-pair', encrypted: true, count: received.length, received, duplicates };
}

export function confirmSecureReceipts(input, options = {}) {
  const { repo } = preflightWrite(input, options, 'secure:confirm');
  assertSecureProtocol(repo);
  const senderId = String(options['as-device'] || '');
  invariant(senderId, '--as-device is required', { code: 'INVALID_ARGUMENT' });
  const directory = path.join(channelRoot(repo, options), safeSegment(senderId), 'receipts');
  const imported = [];
  const duplicates = [];
  for (const source of walkJson(directory)) {
    const receipt = readJson(source);
    const receiver = findDeviceIdentity(repo, receipt.receiver?.device_id)?.identity || null;
    const envelopeHit = findSecureEnvelope(repo, receipt.envelope?.id);
    const valid = verifySeal(receipt)
      && receiver && verifySeal(receiver) && receiver.status === 'ACTIVE'
      && verifyDocumentSignature(receipt, receiver.keys.signing.public_jwk)
      && envelopeHit && envelopeHit.envelope.integrity.digest === receipt.envelope.fingerprint
      && envelopeHit.envelope.message.event_fingerprint === receipt.message.event_fingerprint
      && envelopeHit.envelope.sender.device_id === senderId
      && envelopeHit.envelope.recipient.device_id === receipt.receiver.device_id;
    invariant(valid, `Secure receipt ${receipt.id || 'unknown'} failed verification`, { code: 'SECURE_RECEIPT_INVALID', exitCode: 3 });
    const file = path.join(repo.paths.secureReceipts, `${receipt.id}.json`);
    const duplicate = writeIdempotent(file, receipt, 'secure receipt');
    const item = { receipt_id: receipt.id, receipt_fingerprint: receipt.integrity.digest, envelope_id: receipt.envelope.id, event_id: receipt.message.event_id, outcome: receipt.outcome };
    (duplicate ? duplicates : imported).push(item);
  }
  return { ok: true, status: imported.length ? 'DELIVERY_CONFIRMED' : 'NO_NEW_RECEIPTS', sender_device_id: senderId, identity_assurance: 'device-key-pair', count: imported.length, imported, duplicates };
}

export function inspectSecureEnvelope(input, id) {
  const repo = repository(input);
  const hit = findSecureEnvelope(repo, id);
  invariant(hit, `Secure envelope not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const checks = secureChecks(repo, hit.envelope);
  return { ok: Object.values(checks).every(Boolean), secure_envelope_id: id, fingerprint: hit.envelope.integrity.digest, ...checks, identity_assurance: 'device-key-pair', encrypted: true, file: relativeUnix(repo.repoRoot, hit.file) };
}

export function inspectSecureReceipt(input, id) {
  const repo = repository(input);
  const hit = findSecureReceipt(repo, id);
  invariant(hit, `Secure receipt not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const receiver = findDeviceIdentity(repo, hit.receipt.receiver?.device_id)?.identity || null;
  const envelope = findSecureEnvelope(repo, hit.receipt.envelope?.id)?.envelope || null;
  const checks = {
    integrity_valid: verifySeal(hit.receipt),
    receiver_identity_valid: Boolean(receiver && verifySeal(receiver) && receiver.status === 'ACTIVE'),
    signature_valid: Boolean(receiver && verifyDocumentSignature(hit.receipt, receiver.keys.signing.public_jwk)),
    envelope_matches: Boolean(envelope && envelope.integrity.digest === hit.receipt.envelope.fingerprint && envelope.message.event_fingerprint === hit.receipt.message.event_fingerprint),
    receiver_matches_destination: Boolean(envelope && envelope.recipient.device_id === hit.receipt.receiver.device_id),
  };
  const ok = Object.values(checks).every(Boolean) && hit.receipt.outcome === 'RECEIVED';
  return { ok, secure_receipt_id: id, fingerprint: hit.receipt.integrity.digest, ...checks, identity_assurance: 'device-key-pair', delivery_confirmed: ok, file: relativeUnix(repo.repoRoot, hit.file) };
}
