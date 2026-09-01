import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  CERTAINTY_LEVELS,
  CONTINUITY_ACTION_STATUSES,
  CONTINUITY_EVENT_PROTOCOL_VERSIONS,
  CONTINUITY_EVENT_TYPES,
  CONTINUITY_TRANSPORT_STATUSES,
  EVIDENCE_TYPES,
  PHASES,
  PROTOCOL_VERSION,
  RELAY_RECEIPT_OUTCOMES,
  RECORD_KINDS,
  SUPPORTED_PROTOCOL_VERSIONS,
  STATUS_BY_KIND,
} from './constants.mjs';
import { canonicalJson, digestObject } from './canonical-json.mjs';
import { readJson, relativeUnix, walkFiles, walkJson } from './fs-utils.mjs';
import { gitCommitRelation, gitState } from './git.mjs';
import { resolveRepository, statePaths } from './root.mjs';

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /(?:sk|rk)-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:password|passwd|api[_-]?key|secret)\s*[:=]\s*["'][^"']{8,}["']/i,
];

function required(object, keys, file, errors) {
  for (const key of keys) {
    if (object[key] === undefined) errors.push(`${file}: missing ${key}`);
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateSchemaVersion(value, file, errors, allowed = SUPPORTED_PROTOCOL_VERSIONS) {
  if (!allowed.includes(value)) errors.push(`${file}: unsupported schema_version ${value}`);
}

function validateActor(actor, file, errors) {
  if (!actor || typeof actor !== 'object') {
    errors.push(`${file}: actor must be an object`);
    return;
  }
  required(actor, ['name', 'platform', 'model'], `${file}.actor`, errors);
}

function validateRecord(record, file, errors, warnings) {
  required(record, [
    'schema_version', 'id', 'kind', 'project_id', 'title', 'status', 'confidence',
    'created_at', 'updated_at', 'actor', 'source_refs', 'base_commit',
  ], file, errors);
  validateSchemaVersion(record.schema_version, file, errors);
  if (![...RECORD_KINDS, 'evidence'].includes(record.kind)) errors.push(`${file}: invalid kind ${record.kind}`);
  if (!CERTAINTY_LEVELS.includes(record.confidence)) errors.push(`${file}: invalid confidence ${record.confidence}`);
  if (!Array.isArray(record.source_refs)) errors.push(`${file}: source_refs must be an array`);
  if (!validTimestamp(record.created_at) || !validTimestamp(record.updated_at)) errors.push(`${file}: invalid timestamp`);
  validateActor(record.actor, file, errors);
  const statuses = STATUS_BY_KIND[record.kind];
  if (statuses && !statuses.has(record.status)) errors.push(`${file}: invalid ${record.kind} status ${record.status}`);
  if (record.kind === 'decision' && record.status === 'ACCEPTED' && !['VERIFIED', 'USER_CONFIRMED'].includes(record.confidence)) {
    errors.push(`${file}: accepted decision requires VERIFIED or USER_CONFIRMED`);
  }
  if (record.kind === 'qa' && record.status === 'PASS' && (!Array.isArray(record.source_refs) || record.source_refs.length === 0)) {
    errors.push(`${file}: PASS QA requires evidence source_refs`);
  }
  if (record.kind === 'evidence') {
    if (!EVIDENCE_TYPES.includes(record.evidence_type)) errors.push(`${file}: invalid evidence_type ${record.evidence_type}`);
    if (!record.locator) errors.push(`${file}: evidence locator is required`);
    if (record.result === undefined) errors.push(`${file}: evidence result is required`);
  }
  if (record.confidence === 'VERIFIED' && record.kind !== 'evidence' && record.source_refs?.length === 0) {
    warnings.push(`${file}: VERIFIED record has no source_refs`);
  }
}

function validateIntegrity(object, file, errors) {
  const envelope = object.integrity;
  if (!envelope || envelope.algorithm !== 'sha256' || envelope.canonicalization !== 'ahp-canonical-json-v1' || !envelope.digest) {
    errors.push(`${file}: invalid integrity envelope`);
    return;
  }
  const expected = digestObject({
    ...object,
    integrity: { ...envelope, digest: null },
  });
  if (expected !== envelope.digest) errors.push(`${file}: integrity digest mismatch`);
}

function validateCheckpoint(checkpoint, file, errors) {
  required(checkpoint, [
    'schema_version', 'id', 'kind', 'session_id', 'project_id', 'summary',
    'next_action', 'actor', 'git', 'created_at', 'integrity',
  ], file, errors);
  validateSchemaVersion(checkpoint.schema_version, file, errors);
  if (checkpoint.kind !== 'checkpoint') errors.push(`${file}: kind must be checkpoint`);
  validateActor(checkpoint.actor, file, errors);
  validateIntegrity(checkpoint, file, errors);
}

function validateHandoff(handoff, file, errors) {
  required(handoff, [
    'schema_version', 'id', 'kind', 'from', 'to', 'project_id', 'objective',
    'git', 'portability', 'completed', 'in_progress', 'pending', 'decisions',
    'validations', 'risks', 'relevant_files', 'next_action', 'done_criteria',
    'created_at', 'receiver_preflight', 'integrity',
  ], file, errors);
  validateSchemaVersion(handoff.schema_version, file, errors);
  if (handoff.kind !== 'handoff') errors.push(`${file}: kind must be handoff`);
  validateIntegrity(handoff, file, errors);
}

function validateContinuityEvent(event, file, errors) {
  required(event, [
    'schema_version', 'id', 'kind', 'project_id', 'session_id', 'correlation_id',
    'sequence', 'event_type', 'summary', 'from', 'actor', 'causal', 'intent',
    'observation', 'git', 'privacy', 'transport', 'limitations', 'next_action',
    'created_at', 'integrity',
  ], file, errors);
  validateSchemaVersion(event.schema_version, file, errors, CONTINUITY_EVENT_PROTOCOL_VERSIONS);
  if (event.kind !== 'continuity_event') errors.push(`${file}: kind must be continuity_event`);
  if (!CONTINUITY_EVENT_TYPES.includes(event.event_type)) errors.push(`${file}: invalid event_type ${event.event_type}`);
  if (!Number.isInteger(event.sequence) || event.sequence < 1) errors.push(`${file}: sequence must be a positive integer`);
  if (!CONTINUITY_ACTION_STATUSES.includes(event.observation?.status)) errors.push(`${file}: invalid observation status ${event.observation?.status}`);
  if (['EXECUTED', 'VERIFIED'].includes(event.observation?.status)
    && (!Array.isArray(event.observation?.evidence_refs)
      || event.observation.evidence_refs.length === 0
      || event.observation.evidence_refs.some((reference) => !String(reference).startsWith('EVD-')))) {
    errors.push(`${file}: ${event.observation?.status} continuity event requires evidence_refs with EVD IDs`);
  }
  if (!CONTINUITY_TRANSPORT_STATUSES.includes(event.transport?.status)) errors.push(`${file}: invalid transport status ${event.transport?.status}`);
  if (!Array.isArray(event.limitations)) errors.push(`${file}: limitations must be an array`);
  validateActor(event.actor, file, errors);
  validateIntegrity(event, file, errors);
}

function validateAuthentication(value, file, errors) {
  const authentication = value?.authentication;
  if (!authentication || authentication.scheme !== 'hmac-sha256') {
    errors.push(`${file}: authentication scheme must be hmac-sha256`);
    return;
  }
  if (authentication.credential_scope !== 'project-shared-secret') {
    errors.push(`${file}: authentication credential_scope must be project-shared-secret`);
  }
  if (typeof authentication.key_id !== 'string' || !/^hmac:[a-f0-9]{24}$/.test(authentication.key_id)) {
    errors.push(`${file}: invalid authentication key_id`);
  }
  if (typeof authentication.signature !== 'string' || !/^[a-f0-9]{64}$/.test(authentication.signature)) {
    errors.push(`${file}: invalid authentication signature`);
  }
}

function validateRelayEnvelope(envelope, file, errors) {
  required(envelope, [
    'schema_version', 'id', 'kind', 'project_id', 'provider', 'message',
    'delivery', 'payload', 'created_at', 'authentication', 'integrity',
  ], file, errors);
  validateSchemaVersion(envelope.schema_version, file, errors, ['1.3.0', '1.4.0']);
  if (envelope.kind !== 'relay_envelope') errors.push(`${file}: kind must be relay_envelope`);
  if (!/^RLY-[0-9]{8}-[A-F0-9]{8}$/.test(envelope.id || '')) errors.push(`${file}: invalid relay envelope ID`);
  required(envelope.message || {}, ['event_id', 'event_fingerprint', 'session_id', 'from', 'to'], `${file}.message`, errors);
  required(envelope.delivery || {}, ['state', 'attempt_id', 'nonce', 'created_at', 'expires_at'], `${file}.delivery`, errors);
  if (envelope.delivery?.state !== 'SYNC_PENDING') errors.push(`${file}: delivery state must be SYNC_PENDING`);
  if (!validTimestamp(envelope.created_at) || !validTimestamp(envelope.delivery?.created_at) || !validTimestamp(envelope.delivery?.expires_at)) {
    errors.push(`${file}: invalid relay timestamp`);
  }
  if (validTimestamp(envelope.delivery?.created_at) && validTimestamp(envelope.delivery?.expires_at)
    && Date.parse(envelope.delivery.expires_at) <= Date.parse(envelope.delivery.created_at)) {
    errors.push(`${file}: expires_at must be after delivery.created_at`);
  }
  validateAuthentication(envelope, file, errors);
  validateIntegrity(envelope, file, errors);
  validateContinuityEvent(envelope.payload || {}, `${file}.payload`, errors);
  if (envelope.payload?.id !== envelope.message?.event_id) errors.push(`${file}: payload ID differs from message.event_id`);
  if (envelope.payload?.integrity?.digest !== envelope.message?.event_fingerprint) errors.push(`${file}: payload fingerprint differs from message.event_fingerprint`);
  if (envelope.payload?.session_id !== envelope.message?.session_id) errors.push(`${file}: payload session differs from message.session_id`);
  if (envelope.payload?.from !== envelope.message?.from || envelope.payload?.to !== envelope.message?.to) errors.push(`${file}: payload route differs from message route`);
}

function validateRelayReceipt(receipt, file, errors) {
  required(receipt, [
    'schema_version', 'id', 'kind', 'project_id', 'envelope', 'message',
    'receiver', 'outcome', 'transport', 'received_at', 'created_at',
    'authentication', 'integrity',
  ], file, errors);
  validateSchemaVersion(receipt.schema_version, file, errors, ['1.3.0', '1.4.0']);
  if (receipt.kind !== 'relay_receipt') errors.push(`${file}: kind must be relay_receipt`);
  if (!/^RCP-[0-9]{8}-[A-F0-9]{8}$/.test(receipt.id || '')) errors.push(`${file}: invalid relay receipt ID`);
  required(receipt.envelope || {}, ['id', 'fingerprint'], `${file}.envelope`, errors);
  required(receipt.message || {}, ['event_id', 'event_fingerprint', 'session_id', 'from', 'to'], `${file}.message`, errors);
  required(receipt.receiver || {}, ['platform', 'actor', 'model'], `${file}.receiver`, errors);
  required(receipt.transport || {}, ['provider', 'channel_id'], `${file}.transport`, errors);
  if (!RELAY_RECEIPT_OUTCOMES.includes(receipt.outcome)) errors.push(`${file}: invalid relay receipt outcome ${receipt.outcome}`);
  if (!validTimestamp(receipt.received_at) || !validTimestamp(receipt.created_at)) errors.push(`${file}: invalid relay receipt timestamp`);
  validateAuthentication(receipt, file, errors);
  validateIntegrity(receipt, file, errors);
}

function validateDeviceIdentity(identity, file, errors) {
  required(identity, [
    'schema_version', 'id', 'kind', 'project_id', 'name', 'platform',
    'assurance', 'status', 'keys', 'created_at', 'integrity',
  ], file, errors);
  validateSchemaVersion(identity.schema_version, file, errors, ['1.4.0']);
  if (identity.kind !== 'device_identity') errors.push(`${file}: kind must be device_identity`);
  if (!/^DEV-[0-9]{8}-[A-F0-9]{8}$/.test(identity.id || '')) errors.push(`${file}: invalid device identity ID`);
  if (identity.assurance !== 'device-key-pair') errors.push(`${file}: assurance must be device-key-pair`);
  if (!['ACTIVE', 'REVOKED'].includes(identity.status)) errors.push(`${file}: invalid device identity status ${identity.status}`);
  if (identity.keys?.signing?.algorithm !== 'ed25519') errors.push(`${file}: signing algorithm must be ed25519`);
  if (identity.keys?.encryption?.algorithm !== 'x25519') errors.push(`${file}: encryption algorithm must be x25519`);
  if (identity.keys?.signing?.public_jwk?.d || identity.keys?.encryption?.public_jwk?.d) errors.push(`${file}: private key material must not be persisted`);
  if (!validTimestamp(identity.created_at)) errors.push(`${file}: invalid device identity timestamp`);
  validateIntegrity(identity, file, errors);
}

function verifyDeviceSignature(value, identity) {
  try {
    const payload = canonicalJson({
      ...value,
      authentication: { ...value.authentication, signature: null },
      integrity: { ...value.integrity, digest: null },
    });
    const key = crypto.createPublicKey({ key: identity.keys.signing.public_jwk, format: 'jwk' });
    return crypto.verify(null, Buffer.from(payload), key, Buffer.from(value.authentication.signature, 'base64'));
  } catch {
    return false;
  }
}

function validateSecureEnvelope(envelope, file, errors, identities) {
  required(envelope, [
    'schema_version', 'id', 'kind', 'project_id', 'identity_assurance', 'sender',
    'recipient', 'message', 'delivery', 'encryption', 'payload', 'created_at',
    'authentication', 'integrity',
  ], file, errors);
  validateSchemaVersion(envelope.schema_version, file, errors, ['1.4.0']);
  if (envelope.kind !== 'secure_envelope') errors.push(`${file}: kind must be secure_envelope`);
  if (!/^SEC-[0-9]{8}-[A-F0-9]{8}$/.test(envelope.id || '')) errors.push(`${file}: invalid secure envelope ID`);
  if (envelope.identity_assurance !== 'device-key-pair') errors.push(`${file}: identity assurance must be device-key-pair`);
  if (envelope.encryption?.algorithm !== 'aes-256-gcm' || envelope.encryption?.key_agreement !== 'x25519-hkdf-sha256') errors.push(`${file}: unsupported secure encryption profile`);
  if (envelope.authentication?.scheme !== 'ed25519' || envelope.authentication?.credential_scope !== 'device-key-pair') errors.push(`${file}: unsupported secure authentication profile`);
  validateIntegrity(envelope, file, errors);
  const sender = identities.get(envelope.sender?.device_id);
  if (!sender) errors.push(`${file}: missing sender device identity ${envelope.sender?.device_id}`);
  else if (!verifyDeviceSignature(envelope, sender)) errors.push(`${file}: invalid device signature`);
}

function validateSecureReceipt(receipt, file, errors, identities, envelopes) {
  required(receipt, [
    'schema_version', 'id', 'kind', 'project_id', 'identity_assurance', 'envelope',
    'message', 'receiver', 'outcome', 'received_at', 'created_at', 'authentication', 'integrity',
  ], file, errors);
  validateSchemaVersion(receipt.schema_version, file, errors, ['1.4.0']);
  if (receipt.kind !== 'secure_receipt') errors.push(`${file}: kind must be secure_receipt`);
  if (!/^SRC-[0-9]{8}-[A-F0-9]{8}$/.test(receipt.id || '')) errors.push(`${file}: invalid secure receipt ID`);
  if (!RELAY_RECEIPT_OUTCOMES.includes(receipt.outcome)) errors.push(`${file}: invalid secure receipt outcome ${receipt.outcome}`);
  validateIntegrity(receipt, file, errors);
  const receiver = identities.get(receipt.receiver?.device_id);
  if (!receiver) errors.push(`${file}: missing receiver device identity ${receipt.receiver?.device_id}`);
  else if (!verifyDeviceSignature(receipt, receiver)) errors.push(`${file}: invalid device signature`);
  const envelope = envelopes.get(receipt.envelope?.id);
  if (!envelope) errors.push(`${file}: missing secure envelope ${receipt.envelope?.id}`);
  else if (envelope.integrity?.digest !== receipt.envelope?.fingerprint) errors.push(`${file}: secure envelope fingerprint mismatch`);
}

function validateLock(lock, file, errors, warnings) {
  required(lock, ['schema_version', 'id', 'scope', 'owner', 'created_at', 'expires_at', 'base_commit'], file, errors);
  validateSchemaVersion(lock.schema_version, file, errors);
  if (!validTimestamp(lock.created_at) || !validTimestamp(lock.expires_at)) errors.push(`${file}: invalid timestamp`);
  if (validTimestamp(lock.expires_at) && Date.parse(lock.expires_at) <= Date.now()) warnings.push(`${file}: expired lock`);
}

function scanSecrets(stateRoot, errors) {
  for (const file of walkFiles(stateRoot)) {
    if (!file.endsWith('.json') && !file.endsWith('.md') && !file.endsWith('.patch')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        errors.push(`${relativeUnix(stateRoot, file)}: possible secret detected`);
        break;
      }
    }
  }
}

function verifyLegacy(resolved, options) {
  const errors = [];
  const warnings = ['Legacy /agent layout detected; run `ahp migrate --plan`.'];
  const paths = statePaths(resolved);
  for (const file of [paths.manifest, paths.projectState, path.join(resolved.stateRoot, 'PROJECTS.json'), path.join(resolved.stateRoot, 'BACKLOG.json')]) {
    if (!fs.existsSync(file)) errors.push(`missing ${relativeUnix(resolved.repoRoot, file)}`);
  }
  for (const file of walkJson(resolved.stateRoot)) {
    try { readJson(file); } catch (error) { errors.push(error.message); }
  }
  scanSecrets(resolved.stateRoot, errors);
  return {
    ok: errors.length === 0 && !(options.strict && warnings.length > 0),
    protocol: 'AHP+',
    protocol_version: '1.0.0',
    layout: 'legacy',
    root: resolved.repoRoot,
    state_root: resolved.stateRoot,
    git: gitState(resolved.repoRoot),
    errors,
    warnings,
    strict: Boolean(options.strict),
  };
}

export function verifyRepository(input = '.', options = {}) {
  const resolved = resolveRepository(input);
  if (resolved.layout === 'legacy') return verifyLegacy(resolved, options);

  const errors = [];
  const warnings = [];
  const paths = statePaths(resolved);
  for (const file of [paths.manifest, paths.projectState]) {
    if (!fs.existsSync(file)) errors.push(`missing ${relativeUnix(resolved.repoRoot, file)}`);
  }
  if (errors.length) {
    return { ok: false, protocol: 'AHP+', layout: 'modern', root: resolved.repoRoot, errors, warnings, strict: Boolean(options.strict) };
  }

  const manifest = readJson(paths.manifest);
  const project = readJson(paths.projectState);
  required(manifest, ['schema_version', 'protocol', 'protocol_version', 'instance_id', 'project_id', 'owner', 'root', 'created_at', 'governance'], 'manifest.json', errors);
  validateSchemaVersion(manifest.schema_version, 'manifest.json', errors);
  if (manifest.protocol !== 'AHP+') errors.push('manifest.json: protocol must be AHP+');
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(manifest.protocol_version)) {
    errors.push(`manifest protocol version ${manifest.protocol_version} is not supported by CLI protocol ${PROTOCOL_VERSION}`);
  }
  if (manifest.root !== '.ahp') errors.push('manifest.json: root must be .ahp');
  required(project, ['schema_version', 'project_id', 'phase', 'objective', 'next_action', 'confidence', 'blockers', 'base_commit', 'created_at', 'updated_at'], 'state/project.json', errors);
  validateSchemaVersion(project.schema_version, 'state/project.json', errors);
  if (project.project_id !== manifest.project_id) errors.push('state/project.json: project_id differs from manifest');
  if (!PHASES.includes(project.phase)) errors.push(`state/project.json: invalid phase ${project.phase}`);
  if (!CERTAINTY_LEVELS.includes(project.confidence)) errors.push(`state/project.json: invalid confidence ${project.confidence}`);
  if (!Array.isArray(project.blockers)) errors.push('state/project.json: blockers must be an array');

  const ids = new Map();
  const references = [];
  const recordFiles = [
    ...walkJson(paths.records),
    ...walkJson(paths.evidence),
  ];
  for (const file of recordFiles) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const record = readJson(file);
    validateRecord(record, relative, errors, warnings);
    if (record.project_id && record.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    if (record.id) {
      if (ids.has(record.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(record.id)}`);
      else ids.set(record.id, relative);
    }
    for (const reference of record.source_refs || []) references.push({ file: relative, reference });
  }

  for (const file of walkJson(paths.sessions)) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const checkpoint = readJson(file);
    validateCheckpoint(checkpoint, relative, errors);
    if (checkpoint.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    if (checkpoint.id) {
      if (ids.has(checkpoint.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(checkpoint.id)}`);
      else ids.set(checkpoint.id, relative);
    }
  }

  for (const file of walkJson(paths.handoffs)) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const handoff = readJson(file);
    validateHandoff(handoff, relative, errors);
    if (handoff.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    if (handoff.id) {
      if (ids.has(handoff.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(handoff.id)}`);
      else ids.set(handoff.id, relative);
    }
  }

  const deviceIdentities = new Map();
  for (const file of walkJson(paths.identitiesDevices)) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const identity = readJson(file);
    validateDeviceIdentity(identity, relative, errors);
    if (identity.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    if (identity.id) {
      if (ids.has(identity.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(identity.id)}`);
      else ids.set(identity.id, relative);
      deviceIdentities.set(identity.id, identity);
    }
  }

  const secureEnvelopes = new Map();
  for (const file of [...walkJson(paths.secureOutbox), ...walkJson(paths.secureInbox)]) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const envelope = readJson(file);
    validateSecureEnvelope(envelope, relative, errors, deviceIdentities);
    if (envelope.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    const prior = secureEnvelopes.get(envelope.id);
    if (prior && prior.integrity?.digest !== envelope.integrity?.digest) errors.push(`${relative}: conflicting secure envelope ID`);
    else if (!prior) secureEnvelopes.set(envelope.id, envelope);
  }
  for (const file of walkJson(paths.secureReceipts)) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const receipt = readJson(file);
    validateSecureReceipt(receipt, relative, errors, deviceIdentities, secureEnvelopes);
    if (receipt.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
  }

  const events = new Map();
  const sessionSequences = new Map();
  for (const file of walkJson(paths.events)) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const event = readJson(file);
    validateContinuityEvent(event, relative, errors);
    if (event.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    if (event.id) {
      if (ids.has(event.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(event.id)}`);
      else ids.set(event.id, relative);
      events.set(event.id, { event, relative });
    }
    const sequenceKey = `${event.session_id}:${event.sequence}`;
    if (sessionSequences.has(sequenceKey)) errors.push(`${relative}: duplicate session sequence also in ${sessionSequences.get(sequenceKey)}`);
    else sessionSequences.set(sequenceKey, relative);
    for (const reference of event.observation?.evidence_refs || []) references.push({ file: relative, reference });
  }
  for (const { event, relative } of events.values()) {
    const parentId = event.causal?.parent_event_id;
    if (!parentId) continue;
    const parent = events.get(parentId)?.event;
    if (!parent) errors.push(`${relative}: missing causal parent ${parentId}`);
    else if (parent.integrity?.digest !== event.causal?.parent_fingerprint) errors.push(`${relative}: causal parent fingerprint mismatch`);
    else if (parent.session_id === event.session_id && Number(parent.sequence) >= Number(event.sequence)) errors.push(`${relative}: causal parent sequence must precede child sequence`);
  }

  const relayEnvelopes = new Map();
  for (const file of [...walkJson(paths.relayOutbox), ...walkJson(paths.relayInbox)]) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const envelope = readJson(file);
    validateRelayEnvelope(envelope, relative, errors);
    if (envelope.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    const prior = relayEnvelopes.get(envelope.id);
    if (prior && prior.envelope.integrity?.digest !== envelope.integrity?.digest) {
      errors.push(`${relative}: conflicting relay envelope ID also in ${prior.relative}`);
    } else if (!prior) {
      relayEnvelopes.set(envelope.id, { envelope, relative });
      if (ids.has(envelope.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(envelope.id)}`);
      else ids.set(envelope.id, relative);
    }
    const event = events.get(envelope.message?.event_id)?.event;
    if (!event) errors.push(`${relative}: missing relayed continuity event ${envelope.message?.event_id}`);
    else if (event.integrity?.digest !== envelope.message?.event_fingerprint) errors.push(`${relative}: relayed event fingerprint mismatch`);
  }

  for (const file of walkJson(paths.relayReceipts)) {
    const relative = relativeUnix(resolved.stateRoot, file);
    const receipt = readJson(file);
    validateRelayReceipt(receipt, relative, errors);
    if (receipt.project_id !== manifest.project_id) errors.push(`${relative}: project_id differs from manifest`);
    if (receipt.id) {
      if (ids.has(receipt.id)) errors.push(`${relative}: duplicate ID also in ${ids.get(receipt.id)}`);
      else ids.set(receipt.id, relative);
    }
    const envelope = relayEnvelopes.get(receipt.envelope?.id)?.envelope;
    if (!envelope) errors.push(`${relative}: missing relay envelope ${receipt.envelope?.id}`);
    else {
      if (envelope.integrity?.digest !== receipt.envelope?.fingerprint) errors.push(`${relative}: relay envelope fingerprint mismatch`);
      if (envelope.message?.event_id !== receipt.message?.event_id
        || envelope.message?.event_fingerprint !== receipt.message?.event_fingerprint) errors.push(`${relative}: receipt message differs from relay envelope`);
      if (envelope.message?.to !== receipt.receiver?.platform) errors.push(`${relative}: receipt receiver differs from relay destination`);
      if (envelope.message?.from !== receipt.message?.from || envelope.message?.to !== receipt.message?.to) errors.push(`${relative}: receipt route differs from relay envelope`);
    }
  }
  const sequencesBySession = new Map();
  for (const { event, relative } of events.values()) {
    const values = sequencesBySession.get(event.session_id) || [];
    values.push({ sequence: Number(event.sequence), relative });
    sequencesBySession.set(event.session_id, values);
  }
  for (const values of sequencesBySession.values()) {
    values.sort((left, right) => left.sequence - right.sequence);
    values.forEach((value, index) => {
      if (value.sequence !== index + 1) errors.push(`${value.relative}: session sequence gap; expected ${index + 1}, found ${value.sequence}`);
    });
  }

  for (const file of walkJson(paths.locks)) validateLock(readJson(file), relativeUnix(resolved.stateRoot, file), errors, warnings);
  for (const { file, reference } of references) {
    if (typeof reference !== 'string' || !/^(DEC|TASK|BUG|RISK|QA|REQ|EVD|CHK|HOF)-/.test(reference)) continue;
    if (!ids.has(reference)) warnings.push(`${file}: unresolved source_ref ${reference}`);
  }

  const git = gitState(resolved.repoRoot);
  if (project.base_commit && git.commit && project.base_commit !== git.commit) {
    const relation = gitCommitRelation(resolved.repoRoot, project.base_commit, git.commit);
    if (relation.relation === 'BASE_UNAVAILABLE') {
      warnings.push(`state/project.json: base_commit ${project.base_commit.slice(0, 8)} is unavailable in this Git history; fetch sufficient history to verify ancestry`);
    } else if (relation.relation !== 'AHP_ENVELOPE_DESCENDANT') {
      warnings.push(`state/project.json: base_commit is stale (${project.base_commit.slice(0, 8)} != ${git.commit.slice(0, 8)}); after review run \`ahp set-state . --accept-head --expected-head ${git.commit}\``);
    }
  }
  scanSecrets(resolved.stateRoot, errors);

  const valid = errors.length === 0;
  const strictConformance = valid && warnings.length === 0;
  return {
    ok: valid && !(options.strict && warnings.length > 0),
    valid,
    strict_conformance: strictConformance ? 'PASS' : 'FAIL',
    protocol: 'AHP+',
    protocol_version: PROTOCOL_VERSION,
    layout: 'modern',
    root: resolved.repoRoot,
    state_root: resolved.stateRoot,
    project_id: manifest.project_id,
    git,
    errors,
    warnings,
    checked_files: walkJson(resolved.stateRoot).length,
    strict: Boolean(options.strict),
  };
}
