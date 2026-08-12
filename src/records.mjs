import fs from 'node:fs';
import path from 'node:path';
import {
  CERTAINTY_LEVELS,
  EVIDENCE_TYPES,
  ID_PREFIXES,
  PROTOCOL_VERSION,
  RECORD_KINDS,
  STATUS_BY_KIND,
  TERMINAL_STATUSES,
} from './constants.mjs';
import { csv } from './args.mjs';
import { AhpError, invariant } from './errors.mjs';
import { makeId, now, readJson, walkJson, writeJsonAtomic, writeJsonExclusive } from './fs-utils.mjs';
import { preflightWrite, recordFile } from './preflight.mjs';
import { projectId, repository } from './state.mjs';

const DEFAULT_STATUS = Object.freeze({
  decision: 'PROPOSED',
  task: 'OPEN',
  bug: 'OPEN',
  risk: 'OPEN',
  qa: 'NOT_RUN',
  requirement: 'PROPOSED',
  evidence: 'OBSERVED',
});

export function actorFrom(options = {}) {
  return {
    name: String(options.actor || 'AI agent'),
    platform: String(options.platform || 'unknown'),
    model: String(options.model || 'unknown'),
  };
}

function assertCommon(kind, options) {
  invariant(options.title, '--title is required', { code: 'INVALID_ARGUMENT' });
  const status = String(options.status || DEFAULT_STATUS[kind]);
  const confidence = String(options.confidence || 'UNVERIFIED');
  invariant(STATUS_BY_KIND[kind]?.has(status), `Invalid ${kind} status ${status}`, { code: 'INVALID_STATUS' });
  invariant(CERTAINTY_LEVELS.includes(confidence), `Invalid confidence ${confidence}`, { code: 'INVALID_CONFIDENCE' });
  if (kind === 'decision' && status === 'ACCEPTED') {
    invariant(['VERIFIED', 'USER_CONFIRMED'].includes(confidence), 'Accepted decisions require VERIFIED or USER_CONFIRMED confidence', { code: 'INVALID_CONFIDENCE' });
  }
  return { status, confidence };
}

function directoryFor(repo, kind) {
  if (kind === 'evidence') return repo.paths.evidence;
  const plural = kind === 'qa' ? 'qa' : `${kind}s`;
  return path.join(repo.paths.records, plural);
}

export function allRecords(repoOrInput = '.') {
  const repo = typeof repoOrInput === 'string' ? repository(repoOrInput) : repoOrInput;
  return [...walkJson(repo.paths.records), ...walkJson(repo.paths.evidence)]
    .map((file) => ({ file, record: readJson(file) }))
    .sort((left, right) => String(right.record.updated_at || '').localeCompare(String(left.record.updated_at || '')));
}

export function findRecord(repoOrInput, id) {
  return allRecords(repoOrInput).find(({ record }) => record.id === id) || null;
}

export function createRecord(input, kind, options = {}) {
  invariant(RECORD_KINDS.includes(kind), `Invalid record kind ${kind}`, { code: 'INVALID_KIND' });
  const { repo } = preflightWrite(input, options, `record:${kind}`);
  const { status, confidence } = assertCommon(kind, options);
  const sourceRefs = csv(options.source);
  if (kind === 'qa' && status === 'PASS') {
    invariant(sourceRefs.length > 0 && sourceRefs.every((reference) => reference.startsWith('EVD-')),
      'PASS QA requires --source with one or more EVD IDs', { code: 'MISSING_EVIDENCE' });
  }
  const timestamp = now();
  const id = makeId(ID_PREFIXES[kind]);
  const record = {
    schema_version: PROTOCOL_VERSION,
    id,
    kind,
    project_id: projectId(repo, options.project),
    title: String(options.title),
    description: String(options.description || ''),
    status,
    confidence,
    created_at: timestamp,
    updated_at: timestamp,
    actor: actorFrom(options),
    source_refs: sourceRefs,
    base_commit: repo.git.commit,
    tags: csv(options.tags),
  };
  const file = path.join(directoryFor(repo, kind), `${id}.json`);
  writeJsonExclusive(file, record);
  return { ...record, file: path.relative(repo.repoRoot, file).split(path.sep).join('/') };
}

export function createEvidence(input, options = {}) {
  const { repo } = preflightWrite(input, options, 'evidence');
  const { status, confidence } = assertCommon('evidence', options);
  invariant(options.type && EVIDENCE_TYPES.includes(options.type), `Invalid evidence type ${options.type || 'missing'}`, { code: 'INVALID_EVIDENCE_TYPE' });
  invariant(options.locator, '--locator is required', { code: 'INVALID_ARGUMENT' });
  invariant(options.result !== undefined, '--result is required', { code: 'INVALID_ARGUMENT' });
  const timestamp = now();
  const id = makeId(ID_PREFIXES.evidence);
  const record = {
    schema_version: PROTOCOL_VERSION,
    id,
    kind: 'evidence',
    project_id: projectId(repo, options.project),
    title: String(options.title),
    description: String(options.description || ''),
    status,
    confidence,
    created_at: timestamp,
    updated_at: timestamp,
    observed_at: String(options['observed-at'] || timestamp),
    actor: actorFrom(options),
    source_refs: csv(options.source),
    base_commit: repo.git.commit,
    tags: csv(options.tags),
    evidence_type: String(options.type),
    locator: String(options.locator),
    result: options.result,
    limitations: String(options.limitations || ''),
    artifact_sha256: options.sha256 ? String(options.sha256) : null,
    exit_code: options['exit-code'] === undefined ? null : Number(options['exit-code']),
  };
  const file = path.join(repo.paths.evidence, `${id}.json`);
  writeJsonExclusive(file, record);
  return { ...record, file: path.relative(repo.repoRoot, file).split(path.sep).join('/') };
}

export function listRecords(input, kind = null, options = {}) {
  const repo = repository(input);
  let records = allRecords(repo).map(({ record }) => record);
  if (kind) records = records.filter((record) => record.kind === kind);
  if (options.status) records = records.filter((record) => record.status === options.status);
  if (options.active) records = records.filter((record) => !TERMINAL_STATUSES.has(record.status));
  return { project_id: projectId(repo), kind: kind || 'all', count: records.length, records };
}

export function closeRecord(input, id, options = {}) {
  const { repo } = preflightWrite(input, options, `record:${id}`);
  const hit = findRecord(repo, id);
  invariant(hit, `Record not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  invariant(!(hit.record.kind === 'decision' && hit.record.status === 'ACCEPTED'),
    'Accepted decisions are immutable; use supersede', { code: 'IMMUTABLE_RECORD', exitCode: 2 });
  const allowed = STATUS_BY_KIND[hit.record.kind];
  const status = String(options.status || (hit.record.kind === 'bug' ? 'CLOSED' : 'COMPLETED'));
  invariant(allowed?.has(status) && TERMINAL_STATUSES.has(status), `Status ${status} is not a terminal ${hit.record.kind} status`, { code: 'INVALID_STATUS' });
  const updated = {
    ...hit.record,
    status,
    updated_at: now(),
    closed_at: now(),
    closed_by: actorFrom(options),
    close_base_commit: repo.git.commit,
    close_reason: String(options.reason || ''),
  };
  writeJsonAtomic(hit.file, updated);
  return updated;
}

export function supersedeDecision(input, id, options = {}) {
  const existingRepo = repository(input);
  const existing = findRecord(existingRepo, id);
  invariant(existing?.record.kind === 'decision', `Decision not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  invariant(options.title, '--title is required', { code: 'INVALID_ARGUMENT' });
  const status = options.accept ? 'ACCEPTED' : 'PROPOSED';
  const confidence = String(options.confidence || (options.accept ? 'USER_CONFIRMED' : 'UNVERIFIED'));
  const { repo } = preflightWrite(input, options, `decision:${id}`);
  if (status === 'ACCEPTED') invariant(['VERIFIED', 'USER_CONFIRMED'].includes(confidence), 'Accepted decisions require verified authority', { code: 'INVALID_CONFIDENCE' });
  const timestamp = now();
  const replacement = {
    schema_version: PROTOCOL_VERSION,
    id: makeId(ID_PREFIXES.decision),
    kind: 'decision',
    project_id: projectId(repo),
    title: String(options.title),
    description: String(options.description || ''),
    status,
    confidence,
    created_at: timestamp,
    updated_at: timestamp,
    actor: actorFrom(options),
    source_refs: csv(options.source).length ? csv(options.source) : [id],
    base_commit: repo.git.commit,
    tags: csv(options.tags),
    supersedes: id,
  };
  const file = recordFile(repo, 'decision', replacement.id);
  writeJsonExclusive(file, replacement);
  return replacement;
}
