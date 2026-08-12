export const CLI_VERSION = '1.1.0-emancipation.0';
export const PROTOCOL_VERSION = '1.1.0';
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
});
