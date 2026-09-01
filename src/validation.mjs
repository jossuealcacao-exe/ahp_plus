import fs from 'node:fs';
import path from 'node:path';
import {
  CERTAINTY_LEVELS,
  CONTINUITY_ACTION_STATUSES,
  CONTINUITY_EVENT_TYPES,
  CONTINUITY_TRANSPORT_STATUSES,
  EVIDENCE_TYPES,
  PHASES,
  PROTOCOL_VERSION,
  RECORD_KINDS,
  SUPPORTED_PROTOCOL_VERSIONS,
  STATUS_BY_KIND,
} from './constants.mjs';
import { digestObject } from './canonical-json.mjs';
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
  validateSchemaVersion(event.schema_version, file, errors, [PROTOCOL_VERSION]);
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
