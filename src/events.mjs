import path from 'node:path';
import { csv, pipeList } from './args.mjs';
import {
  CONTINUITY_ACTION_STATUSES,
  CONTINUITY_EVENT_PROTOCOL_VERSIONS,
  CONTINUITY_EVENT_TYPES,
  CONTINUITY_TRANSPORT_STATUSES,
  ID_PREFIXES,
  PROTOCOL_VERSION,
} from './constants.mjs';
import { invariant } from './errors.mjs';
import { makeId, now, readJson, relativeUnix, safeSegment, walkJson, writeJsonExclusive } from './fs-utils.mjs';
import { seal, verifySeal } from './integrity.mjs';
import { preflightWrite } from './preflight.mjs';
import { actorFrom } from './records.mjs';
import { projectId, repository } from './state.mjs';

export function continuityEvents(repoOrInput = '.', options = {}) {
  const repo = typeof repoOrInput === 'string' ? repository(repoOrInput) : repoOrInput;
  let values = walkJson(repo.paths.events).map((file) => ({ file, event: readJson(file) }));
  if (options.session) values = values.filter(({ event }) => event.session_id === options.session);
  if (options.type) values = values.filter(({ event }) => event.event_type === options.type);
  if (options.from) values = values.filter(({ event }) => event.from === options.from);
  if (options.to) values = values.filter(({ event }) => event.to === options.to);
  values.sort((left, right) => {
    const byTime = String(left.event.created_at).localeCompare(String(right.event.created_at));
    return byTime || Number(left.event.sequence || 0) - Number(right.event.sequence || 0);
  });
  const limit = Number(options.limit || 0);
  return limit > 0 ? values.slice(-limit) : values;
}

export function findContinuityEvent(repoOrInput, id) {
  return continuityEvents(repoOrInput).find(({ event }) => event.id === id) || null;
}

function eventType(value) {
  const normalized = String(value || '').toUpperCase();
  invariant(CONTINUITY_EVENT_TYPES.includes(normalized), `Invalid continuity event type ${normalized || 'missing'}. Allowed values: ${CONTINUITY_EVENT_TYPES.join(', ')}`, {
    code: 'INVALID_EVENT_TYPE', details: { value: normalized || null, allowed: CONTINUITY_EVENT_TYPES },
  });
  return normalized;
}

function actionStatus(value) {
  const normalized = String(value || 'NOT_APPLICABLE').toUpperCase();
  invariant(CONTINUITY_ACTION_STATUSES.includes(normalized), `Invalid continuity action status ${normalized}. Allowed values: ${CONTINUITY_ACTION_STATUSES.join(', ')}`, {
    code: 'INVALID_EVENT_STATUS', details: { value: normalized, allowed: CONTINUITY_ACTION_STATUSES },
  });
  return normalized;
}

export function appendContinuityEvent(input, options = {}) {
  invariant(options.summary, '--summary is required', { code: 'INVALID_ARGUMENT' });
  const type = eventType(options.type);
  const owner = options.actor || 'AI agent';
  const { repo } = preflightWrite(input, { ...options, actor: owner }, 'continuity:event');
  invariant(CONTINUITY_EVENT_PROTOCOL_VERSIONS.includes(repo.manifest.protocol_version), `Continuity Events require protocol 1.2.0 or newer; current project is ${repo.manifest.protocol_version}. Run \`ahp upgrade . --plan\`.`, {
    code: 'PROTOCOL_UPGRADE_REQUIRED', exitCode: 2, details: { current: repo.manifest.protocol_version, required: CONTINUITY_EVENT_PROTOCOL_VERSIONS },
  });
  const sessionId = safeSegment(options.session || `${options.platform || 'generic'}-${owner}`);
  const sessionEvents = continuityEvents(repo, { session: sessionId });
  const latest = sessionEvents.at(-1)?.event || null;
  const parent = options.parent === false
    ? null
    : options.parent
      ? findContinuityEvent(repo, String(options.parent))?.event || null
      : latest;
  if (options.parent) invariant(parent, `Parent continuity event not found: ${options.parent}`, { code: 'NOT_FOUND', exitCode: 2 });
  const transportStatus = String(options.transport || 'LOCAL_CAPTURED').toUpperCase();
  invariant(CONTINUITY_TRANSPORT_STATUSES.includes(transportStatus), `Invalid continuity transport status ${transportStatus}. Allowed values: ${CONTINUITY_TRANSPORT_STATUSES.join(', ')}`, {
    code: 'INVALID_TRANSPORT_STATUS', details: { value: transportStatus, allowed: CONTINUITY_TRANSPORT_STATUSES },
  });
  invariant(['LOCAL_CAPTURED', 'CONFLICTED', 'REDACTED'].includes(transportStatus), `Local Core cannot assert transport state ${transportStatus}. Remote states require an authenticated relay or independent receiver receipt.`, {
    code: 'TRANSPORT_EVIDENCE_REQUIRED', details: { value: transportStatus, local_allowed: ['LOCAL_CAPTURED', 'CONFLICTED', 'REDACTED'] },
  });
  const evidenceRefs = csv(options.evidence);
  const observedStatus = actionStatus(options.status);
  if (['EXECUTED', 'VERIFIED'].includes(observedStatus)) {
    invariant(evidenceRefs.length > 0 && evidenceRefs.every((reference) => reference.startsWith('EVD-')),
      `${observedStatus} continuity events require --evidence with one or more EVD IDs`, {
        code: 'MISSING_EVIDENCE', details: { status: observedStatus, evidence_refs: evidenceRefs },
      });
  }
  const id = makeId(ID_PREFIXES.continuity_event);
  const value = seal({
    schema_version: repo.manifest.protocol_version,
    id,
    kind: 'continuity_event',
    project_id: projectId(repo),
    session_id: sessionId,
    correlation_id: String(options.correlation || sessionId),
    sequence: latest ? Number(latest.sequence || 0) + 1 : 1,
    event_type: type,
    summary: String(options.summary),
    from: String(options.from || options.platform || 'current-agent'),
    to: options.to ? String(options.to) : null,
    actor: actorFrom(options),
    capabilities: csv(options.capabilities),
    causal: {
      parent_event_id: parent?.id || null,
      parent_fingerprint: parent?.integrity?.digest || null,
    },
    intent: {
      requested: String(options.requested || ''),
      authority: String(options.authority || 'NOT_GRANTED'),
    },
    observation: {
      status: observedStatus,
      result: options.result === undefined ? null : options.result,
      evidence_refs: evidenceRefs,
      artifacts: csv(options.artifacts),
    },
    git: {
      branch: repo.git.branch,
      commit: repo.git.commit,
      tree: repo.git.tree,
      project_working_tree: repo.git.project_working_tree,
      project_working_tree_digest: repo.git.project_working_tree_digest,
    },
    privacy: {
      classification: String(options.privacy || 'PROJECT'),
      redactions: pipeList(options.redactions),
    },
    transport: {
      status: transportStatus,
      provider: options.provider ? String(options.provider) : null,
    },
    limitations: pipeList(options.limitations),
    next_action: String(options['next-action'] || repo.projectState.next_action),
    created_at: now(),
  });
  const file = path.join(repo.paths.events, sessionId, `${id}.json`);
  writeJsonExclusive(file, value);
  return {
    ...value,
    fingerprint: value.integrity.digest,
    file: relativeUnix(repo.repoRoot, file),
  };
}

export function inspectContinuityEvent(input, id) {
  const repo = repository(input);
  const hit = findContinuityEvent(repo, id);
  invariant(hit, `Continuity event not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const parent = hit.event.causal?.parent_event_id
    ? findContinuityEvent(repo, hit.event.causal.parent_event_id)?.event || null
    : null;
  const parentMatches = !hit.event.causal?.parent_event_id || Boolean(
    parent && parent.integrity?.digest === hit.event.causal.parent_fingerprint,
  );
  return {
    ok: verifySeal(hit.event) && parentMatches,
    event_id: id,
    fingerprint: hit.event.integrity?.digest || null,
    integrity_valid: verifySeal(hit.event),
    causal_parent_valid: parentMatches,
    parent_event_id: hit.event.causal?.parent_event_id || null,
    file: relativeUnix(repo.repoRoot, hit.file),
    event: hit.event,
  };
}

export function listContinuityEvents(input = '.', options = {}) {
  const repo = repository(input);
  const events = continuityEvents(repo, options).map(({ event }) => ({
    ...event,
    fingerprint: event.integrity?.digest || null,
  }));
  return { project_id: projectId(repo), count: events.length, events };
}
