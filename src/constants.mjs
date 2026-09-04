export const CLI_VERSION = '1.4.1';
export const PROTOCOL_VERSION = '1.4.0';
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['1.1.0', '1.2.0', '1.3.0', '1.4.0']);
export const CONTINUITY_EVENT_PROTOCOL_VERSIONS = Object.freeze(['1.2.0', '1.3.0', '1.4.0']);
export const STATE_DIRECTORY = '.ahp';
export const LEGACY_STATE_DIRECTORY = 'agent';
export const CERTAINTY_LEVELS = Object.freeze([
  'VERIFIED',
  'USER_CONFIRMED',
  'INFERRED',
  'UNVERIFIED',
  'STALE',
  'CONFLICTED',
]);
export const PHASES = Object.freeze([
  'DISCOVERY',
  'PLANNED',
  'IN_PROGRESS',
  'BLOCKED',
  'READY_FOR_QA',
  'VERIFIED',
  'COMPLETED',
  'ARCHIVED',
  'REJECTED',
]);
export const CONTINUITY_EVENT_TYPES = Object.freeze([
  'DIRECTIVE',
  'DECISION',
  'ACTION',
  'OBSERVATION',
  'VALIDATION',
  'ERROR',
  'BLOCKER',
  'CHECKPOINT',
  'HANDOFF',
  'CAPABILITY_CHANGE',
  'MESSAGE',
  'CONVERSATION_OPENED',
  'CONVERSATION_CLOSED',
  'CONSULT_REQUEST',
  'CONSULT_RESPONSE',
]);
export const CONTINUITY_ACTION_STATUSES = Object.freeze([
  'REQUESTED',
  'ATTEMPTED',
  'EXECUTED',
  'REJECTED',
  'VERIFIED',
  'NOT_APPLICABLE',
]);
export const CONTINUITY_TRANSPORT_STATUSES = Object.freeze([
  'LOCAL_CAPTURED',
  'SYNC_PENDING',
  'REMOTE_AVAILABLE',
  'GIT_ANCHORED',
  'RECEIVED',
  'CONFLICTED',
  'REDACTED',
]);
export const RELAY_RECEIPT_OUTCOMES = Object.freeze([
  'RECEIVED',
  'REJECTED',
  'CONFLICTED',
  'EXPIRED',
]);
export const RECORD_KINDS = Object.freeze([
  'decision',
  'task',
  'bug',
  'risk',
  'qa',
  'requirement',
]);
export const EVIDENCE_TYPES = Object.freeze([
  'file',
  'command',
  'test',
  'commit',
  'url',
  'user_confirmation',
  'artifact',
  'screenshot',
]);
export const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'CLOSED',
  'ARCHIVED',
  'REJECTED',
  'SUPERSEDED',
]);
export const STATUS_BY_KIND = Object.freeze({
  decision: new Set(['PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED']),
  task: new Set(['OPEN', 'PLANNED', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_QA', 'COMPLETED', 'ARCHIVED', 'REJECTED']),
  bug: new Set(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_QA', 'VERIFIED', 'CLOSED', 'ARCHIVED', 'REJECTED']),
  risk: new Set(['OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED', 'ARCHIVED', 'REJECTED']),
  qa: new Set(['PASS', 'FAIL', 'NOT_RUN', 'BLOCKED']),
  requirement: new Set(['PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'VERIFIED', 'COMPLETED', 'REJECTED', 'ARCHIVED']),
  evidence: new Set(['OBSERVED', 'INVALIDATED', 'ARCHIVED']),
});
export const ID_PREFIXES = Object.freeze({
  decision: 'DEC',
  task: 'TASK',
  bug: 'BUG',
  risk: 'RISK',
  qa: 'QA',
  requirement: 'REQ',
  evidence: 'EVD',
  checkpoint: 'CHK',
  handoff: 'HOF',
  lock: 'LOCK',
  continuity_event: 'EVT',
  relay_envelope: 'RLY',
  relay_receipt: 'RCP',
  device_identity: 'DEV',
  secure_envelope: 'SEC',
  secure_receipt: 'SRC',
});
