import { assertKnownOptions, parseArgs } from './args.mjs';
import { CLI_VERSION } from './constants.mjs';
import { AhpError, invariant } from './errors.mjs';
import { resolveRepository } from './root.mjs';
import { initializeRepository, repository, stateRevision, updateProjectState } from './state.mjs';
import { verifyRepository } from './validation.mjs';
import { contextMarkdown, doctor, history, portability, projectContext, readiness, status, writeBrief } from './context.mjs';
import { createCheckpoint } from './checkpoints.mjs';
import { closeRecord, createEvidence, createRecord, listRecords, supersedeDecision } from './records.mjs';
import { createHandoff, inspectHandoff, receiveHandoff } from './handoffs.mjs';
import { acquireLock, releaseLock } from './locks.mjs';
import { applyMigration, migrationPlan } from './migration.mjs';
import { adapterNames, installAdapter } from './adapters.mjs';
import { preflightWrite } from './preflight.mjs';
import { appendContinuityEvent, inspectContinuityEvent, listContinuityEvents } from './events.mjs';
import { applyUpgrade, upgradePlan } from './upgrade.mjs';

const HELP = `AHP+ ${CLI_VERSION}

Repository:
  ahp init [path] --owner NAME [--project ID]
  ahp root [path]
  ahp doctor [path] [--diagnose-git|--verbose]
  ahp verify [path] [--strict]
  ahp status [path]
  ahp sync check [path]
  ahp upgrade [path] --plan|--apply

Context and sessions:
  ahp context [path] [--format json|markdown] [--budget TOKENS]
  ahp brief [path] [--budget TOKENS]
  ahp checkpoint [path] --summary TEXT [--session ID --platform PLATFORM --actor ACTOR --next-action TEXT]
  ahp history [path] [--session ID]
  ahp set-state [path] [--phase PHASE --objective TEXT --next-action TEXT --accept-head]
  ahp ready [path] [--platform PLATFORM]
  ahp event append [path] --type TYPE --summary TEXT [--session ID --parent EVT-ID]
  ahp event list [path] [--session ID --type TYPE --limit N]
  ahp event verify <event-id> [path]

Governance records:
  ahp record <decision|task|bug|risk|qa|requirement> [path] --title TEXT
  ahp record evidence [path] --title TEXT --type TYPE --locator REF --result VALUE
  ahp list [kind] [path] [--status STATUS --active]
  ahp close <record-id> [path] --status STATUS
  ahp supersede <decision-id> [path] --title TEXT [--accept]

Handoff and concurrency:
  ahp handoff create [path] --to PLATFORM [--from PLATFORM --session ID --summary TEXT]
  ahp handoff inspect <handoff-id> [path]
  ahp handoff receive <handoff-id> [path]
  ahp lock acquire [path] --scope PATH --owner ACTOR [--minutes 60]
  ahp lock release <lock-id> [path] --owner ACTOR

Migration and adapters:
  ahp migrate [path] --plan
  ahp migrate [path] --apply
  ahp adapter list
  ahp adapter install <platform|all> [path] [--apply]

All writes accept --expected-head COMMIT and --expected-state DIGEST.
AHP+ never runs Git network or publication commands.`;

const WRITE_OPTIONS = ['expected-head', 'expected-base', 'expected-state'];
const ACTOR_OPTIONS = ['actor', 'platform', 'model'];
const COMMAND_OPTIONS = Object.freeze({
  init: ['owner', 'project', 'phase', 'objective', 'next-action', 'confidence'],
  root: [],
  doctor: ['diagnose-git', 'verbose'],
  verify: ['strict'],
  status: [],
  ready: ['platform'],
  'event:append': ['type', 'summary', 'session', 'parent', 'correlation', 'from', 'to', 'capabilities', 'requested', 'authority', 'status', 'result', 'evidence', 'artifacts', 'transport', 'provider', 'privacy', 'redactions', 'limitations', 'next-action', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'event:list': ['session', 'type', 'limit'],
  'event:verify': [],
  context: ['format', 'budget', 'session', 'project', 'limit', 'handoff-limit', 'event-limit'],
  brief: ['budget', 'json', 'session', 'project', 'limit', 'handoff-limit', 'event-limit'],
  history: ['session', 'project'],
  checkpoint: ['summary', 'session', 'next-action', 'objective', 'files', 'validations', 'blockers', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'set-state': ['phase', 'objective', 'next-action', 'confidence', 'blockers', 'accept-head', ...WRITE_OPTIONS],
  record: ['title', 'description', 'status', 'confidence', 'source', 'tags', 'type', 'locator', 'result', 'limitations', 'sha256', 'exit-code', 'observed-at', 'project', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  list: ['status', 'active'],
  close: ['status', 'reason', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  supersede: ['title', 'description', 'accept', 'confidence', 'source', 'tags', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'handoff:create': ['to', 'from', 'session', 'summary', 'platform', 'project', 'next-action', 'assumptions', 'done-criteria', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'handoff:inspect': [],
  'handoff:receive': [],
  'lock:acquire': ['scope', 'owner', 'minutes', 'purpose', 'platform', ...WRITE_OPTIONS],
  'lock:release': ['owner', 'actor', 'force', ...WRITE_OPTIONS],
  migrate: ['plan', 'apply', ...WRITE_OPTIONS],
  upgrade: ['plan', 'apply', ...WRITE_OPTIONS],
  'adapter:list': [],
  'adapter:install': ['apply', 'replace', ...WRITE_OPTIONS],
  'sync:check': ['require-remote'],
});

function commandKey(positionals) {
  const [command, action] = positionals;
  if (['handoff', 'lock', 'adapter', 'sync', 'event'].includes(command)) return `${command}:${action || ''}`;
  if (recordShortcut(command)) return 'list';
  return command;
}

function output(value) {
  process.stdout.write(typeof value === 'string' ? `${value.replace(/\n?$/, '\n')}` : `${JSON.stringify(value, null, 2)}\n`);
}

function target(options, positional) {
  return String(options.root || positional || '.');
}

function recordShortcut(command) {
  return ({ decisions: 'decision', tasks: 'task', bugs: 'bug', risks: 'risk', qa: 'qa', requirements: 'requirement', evidence: 'evidence' })[command] || null;
}

export async function run(argv) {
  const { options, positionals } = parseArgs(argv);
  const command = positionals[0];
  if (command === 'version' || options.version) return { value: CLI_VERSION, exitCode: 0 };
  if (!command || command === 'help' || options.help) return { value: HELP, exitCode: 0 };
  const key = commandKey(positionals);
  if (COMMAND_OPTIONS[key]) assertKnownOptions(options, COMMAND_OPTIONS[key], key);

  if (command === 'init') return { value: initializeRepository(target(options, positionals[1]), options), exitCode: 0 };
  if (command === 'root') {
    const resolved = resolveRepository(target(options, positionals[1]), { requireState: false });
    return { value: resolved, exitCode: 0 };
  }
  if (command === 'upgrade') {
    const input = target(options, positionals[1]);
    return { value: options.apply ? applyUpgrade(input, options) : upgradePlan(input), exitCode: 0 };
  }
  if (command === 'doctor') {
    const value = doctor(target(options, positionals[1]), options);
    return { value, exitCode: value.ok ? 0 : 2 };
  }
  if (command === 'verify') {
    const value = verifyRepository(target(options, positionals[1]), { strict: Boolean(options.strict) });
    return { value, exitCode: value.ok ? 0 : 2 };
  }
  if (command === 'status') return { value: status(target(options, positionals[1])), exitCode: 0 };
  if (command === 'ready') {
    const value = readiness(target(options, positionals[1]), options);
    return { value, exitCode: value.local_readiness.status === 'READY' ? 0 : 3 };
  }
  if (command === 'event') {
    const action = positionals[1];
    if (action === 'append') return { value: appendContinuityEvent(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'list') return { value: listContinuityEvents(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'verify') {
      const value = inspectContinuityEvent(target(options, positionals[3]), positionals[2]);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    throw new AhpError('Expected `event append`, `event list`, or `event verify`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'context') {
    const value = projectContext(target(options, positionals[1]), options);
    return { value: options.format === 'markdown' ? contextMarkdown(value, options) : value, exitCode: 0 };
  }
  if (command === 'brief') {
    const value = writeBrief(target(options, positionals[1]), options);
    return { value: options.json ? value : value.markdown, exitCode: 0 };
  }
  if (command === 'history') return { value: history(target(options, positionals[1]), options), exitCode: 0 };
  if (command === 'checkpoint') return { value: createCheckpoint(target(options, positionals[1]), options), exitCode: 0 };
  if (command === 'set-state') {
    const input = target(options, positionals[1]);
    const { repo } = preflightWrite(input, options, 'state');
    const value = updateProjectState(repo, options);
    return { value, exitCode: 0 };
  }
  if (command === 'record') {
    const kind = positionals[1];
    invariant(kind, 'Record kind is required', { code: 'INVALID_ARGUMENT' });
    const input = target(options, positionals[2]);
    const value = kind === 'evidence' ? createEvidence(input, options) : createRecord(input, kind, options);
    return { value, exitCode: 0 };
  }
  if (command === 'list') {
    const kind = positionals[1] || null;
    return { value: listRecords(target(options, positionals[2]), kind, options), exitCode: 0 };
  }
  const shortcut = recordShortcut(command);
  if (shortcut) return { value: listRecords(target(options, positionals[1]), shortcut, options), exitCode: 0 };
  if (command === 'close') return { value: closeRecord(target(options, positionals[2]), positionals[1], options), exitCode: 0 };
  if (command === 'supersede') return { value: supersedeDecision(target(options, positionals[2]), positionals[1], options), exitCode: 0 };

  if (command === 'handoff') {
    const action = positionals[1];
    if (action === 'create') return { value: createHandoff(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'inspect') return { value: inspectHandoff(target(options, positionals[3]), positionals[2]), exitCode: 0 };
    if (action === 'receive') {
      const value = receiveHandoff(target(options, positionals[3]), positionals[2]);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    throw new AhpError('Expected `handoff create`, `handoff inspect`, or `handoff receive`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'lock') {
    const action = positionals[1];
    if (action === 'acquire') return { value: acquireLock(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'release') return { value: releaseLock(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    throw new AhpError('Expected `lock acquire` or `lock release`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'migrate') {
    const input = target(options, positionals[1]);
    return { value: options.apply ? applyMigration(input, options) : migrationPlan(input), exitCode: 0 };
  }
  if (command === 'adapter') {
    const action = positionals[1];
    if (action === 'list') return { value: { adapters: adapterNames() }, exitCode: 0 };
    if (action === 'install') return { value: installAdapter(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    throw new AhpError('Expected `adapter list` or `adapter install`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'sync' && positionals[1] === 'check') {
    const repo = repository(target(options, positionals[2]));
    const value = { project_id: repo.manifest.project_id, git: repo.git, portability: portability(repo.git), state_revision: stateRevision(repo) };
    return { value, exitCode: options['require-remote'] && value.portability.status !== 'REMOTE_READY' ? 3 : 0 };
  }
  throw new AhpError(`Unknown command ${command}`, { code: 'UNKNOWN_COMMAND' });
}

export async function main(argv) {
  try {
    const result = await run(argv);
    output(result.value);
    process.exitCode = result.exitCode;
  } catch (error) {
    const known = error instanceof AhpError;
    const payload = {
      ok: false,
      error: known ? error.code : 'UNEXPECTED_ERROR',
      message: error.message,
      details: known ? error.details : null,
    };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = known ? error.exitCode : 1;
  }
}
