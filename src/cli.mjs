import { parseArgs } from './args.mjs';
import { CLI_VERSION } from './constants.mjs';
import { AhpError, invariant } from './errors.mjs';
import { resolveRepository } from './root.mjs';
import { initializeRepository, repository, stateRevision, updateProjectState } from './state.mjs';
import { verifyRepository } from './validation.mjs';
import { contextMarkdown, doctor, history, portability, projectContext, status, writeBrief } from './context.mjs';
import { createCheckpoint } from './checkpoints.mjs';
import { closeRecord, createEvidence, createRecord, listRecords, supersedeDecision } from './records.mjs';
import { createHandoff, inspectHandoff, receiveHandoff } from './handoffs.mjs';
import { acquireLock, releaseLock } from './locks.mjs';
import { applyMigration, migrationPlan } from './migration.mjs';
import { adapterNames, installAdapter } from './adapters.mjs';
import { preflightWrite } from './preflight.mjs';

const HELP = `AHP+ ${CLI_VERSION}

Repository:
  ahp init [path] --owner NAME [--project ID]
  ahp root [path]
  ahp doctor [path]
  ahp verify [path] [--strict]
  ahp status [path]
  ahp sync check [path]

Context and sessions:
  ahp context [path] [--format json|markdown] [--budget TOKENS]
  ahp brief [path] [--budget TOKENS]
  ahp checkpoint [path] --summary TEXT [--session ID --next-action TEXT]
  ahp history [path] [--session ID]
  ahp set-state [path] [--phase PHASE --objective TEXT --next-action TEXT]

Governance records:
  ahp record <decision|task|bug|risk|qa|requirement> [path] --title TEXT
  ahp record evidence [path] --title TEXT --type TYPE --locator REF --result VALUE
  ahp list [kind] [path] [--status STATUS --active]
  ahp close <record-id> [path] --status STATUS
  ahp supersede <decision-id> [path] --title TEXT [--accept]

Handoff and concurrency:
  ahp handoff create [path] --to PLATFORM [--from PLATFORM --summary TEXT]
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
  if (!command || command === 'help' || options.help) return { value: HELP, exitCode: 0 };
  if (command === 'version' || options.version) return { value: CLI_VERSION, exitCode: 0 };

  if (command === 'init') return { value: initializeRepository(target(options, positionals[1]), options), exitCode: 0 };
  if (command === 'root') {
    const resolved = resolveRepository(target(options, positionals[1]), { requireState: false });
    return { value: resolved, exitCode: 0 };
  }
  if (command === 'doctor') {
    const value = doctor(target(options, positionals[1]));
    return { value, exitCode: value.ok ? 0 : 2 };
  }
  if (command === 'verify') {
    const value = verifyRepository(target(options, positionals[1]), { strict: Boolean(options.strict) });
    return { value, exitCode: value.ok ? 0 : 2 };
  }
  if (command === 'status') return { value: status(target(options, positionals[1])), exitCode: 0 };
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
