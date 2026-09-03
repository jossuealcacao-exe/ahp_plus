import { CLI_VERSION } from './constants.mjs';

const CATEGORIES = Object.freeze([
  {
    name: 'setup',
    purpose: 'Install and configure AHP+ in one guided project operation.',
    commands: [
      'ahp setup [path] [--owner NAME --project ID --platforms codex,claude|all --no-identity]',
    ],
    aliases: [],
  },
  {
    name: 'project',
    purpose: 'Initialize, inspect, validate, and evolve the current project.',
    commands: [
      'ahp project init [path] --owner NAME',
      'ahp project check [path] [--platform PLATFORM]',
      'ahp project status [path]',
      'ahp project verify [path] --strict',
      'ahp project doctor [path] [--diagnose-git]',
      'ahp project ready [path] [--platform PLATFORM]',
      'ahp project state [path] [--phase PHASE --next-action TEXT --accept-head]',
      'ahp project root [path]',
      'ahp project upgrade [path] --plan|--apply',
    ],
    aliases: ['init', 'root', 'doctor', 'verify', 'status', 'ready', 'set-state', 'upgrade'],
  },
  {
    name: 'session',
    purpose: 'Load, summarize, checkpoint, and inspect the active work session.',
    commands: [
      'ahp session context [path] [--format json|markdown --budget TOKENS]',
      'ahp session brief [path] [--budget TOKENS]',
      'ahp session checkpoint [path] --summary TEXT [--platform PLATFORM --actor ACTOR --next-action TEXT]',
      'ahp session history [path] [--session ID]',
    ],
    aliases: ['context', 'brief', 'checkpoint', 'history'],
  },
  {
    name: 'message',
    purpose: 'Create and inspect fingerprinted operational messages between AI platforms.',
    commands: [
      'ahp message send "TEXT" --to PLATFORM [--from PLATFORM --session ID]',
      'ahp message reply EVT-ID "TEXT" [--from PLATFORM]',
      'ahp message inbox [path] --for PLATFORM [--session ID]',
      'ahp message outbox [path] --from PLATFORM [--session ID]',
      'ahp message list [path] [--from PLATFORM --to PLATFORM --session ID]',
      'ahp message verify EVT-ID [path]',
    ],
    aliases: ['event append --type MESSAGE', 'event list --type MESSAGE', 'event verify'],
  },
  {
    name: 'agent',
    purpose: 'Request one bounded read-only opinion from another AI platform.',
    commands: [
      'ahp agent ask <codex|claude> "QUESTION" [--from PLATFORM --timeout SECONDS]',
    ],
    aliases: [],
  },
  {
    name: 'conversation',
    purpose: 'Open a shared project conversation room and exchange durable messages between platform participants.',
    commands: [
      'ahp conversation open "TITLE" --participants codex,claude --from codex',
      'ahp conversation list [path] [--for PLATFORM]',
      'ahp conversation send conv-ID "TEXT" --from PLATFORM [--to PLATFORM]',
      'ahp conversation inbox conv-ID --for PLATFORM [--after EVT-ID --limit N]',
      'ahp conversation wait conv-ID --for PLATFORM [--after EVT-ID --timeout SECONDS --interval SECONDS]',
    ],
    aliases: [],
  },
  {
    name: 'live',
    purpose: 'Expose the AHP+ MCP bridge and inspect local provider availability.',
    commands: [
      'ahp live status [path]',
      'ahp live serve [path]',
    ],
    aliases: [],
  },
  {
    name: 'identity',
    purpose: 'Create and verify device-bound signing and encryption identities.',
    commands: [
      'ahp identity create [path] --name NAME --platform PLATFORM [--store DIRECTORY]',
      'ahp identity list [path]',
      'ahp identity verify DEV-ID [path]',
    ],
    aliases: [],
  },
  {
    name: 'secure',
    purpose: 'Encrypt and sign device-to-device messages with receiver-created receipts.',
    commands: [
      'ahp secure send EVT-ID --from-device DEV-ID --to-device DEV-ID --channel DIRECTORY',
      'ahp secure receive --as-device DEV-ID --channel DIRECTORY',
      'ahp secure confirm --as-device DEV-ID --channel DIRECTORY',
      'ahp secure verify SEC-ID',
      'ahp secure receipt verify SRC-ID',
      'ahp secure network send EVT-ID --from-device DEV-ID --to-device DEV-ID --url HTTPS_URL --token-file FILE',
      'ahp secure network receive --as-device DEV-ID --url HTTPS_URL --token-file FILE',
      'ahp secure network confirm --as-device DEV-ID --url HTTPS_URL --token-file FILE',
    ],
    aliases: [],
  },
  {
    name: 'hub',
    purpose: 'Run the reference encrypted-object carrier locally or behind TLS.',
    commands: [
      'ahp hub serve --data-dir DIRECTORY --token-file FILE [--host HOST --port PORT]',
      'ahp hub serve --data-dir DIRECTORY --token-file FILE --host HOST --tls-cert FILE --tls-key FILE',
    ],
    aliases: [],
  },
  {
    name: 'relay',
    purpose: 'Deliver authenticated messages and import receiver-created receipts.',
    commands: [
      'ahp relay send EVT-ID [path] --channel DIRECTORY [--secret-env NAME|--secret-file FILE]',
      'ahp relay receive [path] --as PLATFORM --channel DIRECTORY [--secret-env NAME|--secret-file FILE]',
      'ahp relay wait [path] --as PLATFORM --channel DIRECTORY [--timeout SECONDS]',
      'ahp relay confirm [path] --as PLATFORM --channel DIRECTORY [--secret-env NAME|--secret-file FILE]',
      'ahp relay prepare EVT-ID [path] [--ttl SECONDS --secret-env NAME]',
      'ahp relay push RLY-ID [path] --channel DIRECTORY [--secret-env NAME]',
      'ahp relay pull [path] --for PLATFORM --channel DIRECTORY [--secret-env NAME]',
      'ahp relay watch [path] --for PLATFORM --channel DIRECTORY [--timeout SECONDS]',
      'ahp relay receipts [path] --for PLATFORM --channel DIRECTORY [--secret-env NAME]',
      'ahp relay verify RLY-ID [path] [--secret-env NAME]',
      'ahp relay receipt verify RCP-ID [path] [--secret-env NAME]',
      'ahp relay receipt list [path] [--for PLATFORM --outcome RECEIVED]',
    ],
    aliases: [],
  },
  {
    name: 'record',
    purpose: 'Create and manage typed governance records and evidence.',
    commands: [
      'ahp record add <decision|task|bug|risk|qa|requirement|evidence> [path] --title TEXT',
      'ahp record list [kind] [path] [--status STATUS --active]',
      'ahp record close RECORD-ID [path] --status STATUS',
      'ahp record supersede DECISION-ID [path] --title TEXT [--accept]',
    ],
    aliases: ['record KIND', 'list', 'close', 'supersede'],
  },
  {
    name: 'handoff',
    purpose: 'Prepare, inspect, and receive a sealed project transfer.',
    commands: [
      'ahp handoff create [path] --to PLATFORM [--from PLATFORM --session ID --summary TEXT]',
      'ahp handoff inspect HOF-ID [path]',
      'ahp handoff receive HOF-ID [path]',
    ],
    aliases: [],
  },
  {
    name: 'sync',
    purpose: 'Inspect transport portability without performing Git network operations.',
    commands: ['ahp sync check [path] [--require-remote]'],
    aliases: [],
  },
  {
    name: 'lock',
    purpose: 'Coordinate concurrent writers with cooperative locks.',
    commands: [
      'ahp lock acquire [path] --scope SCOPE --owner ACTOR',
      'ahp lock release LOCK-ID [path] --owner ACTOR',
    ],
    aliases: [],
  },
  {
    name: 'adapter',
    purpose: 'Install chat and IDE surfaces that translate semantic requests to the CLI.',
    commands: [
      'ahp adapter list',
      'ahp adapter install <platform|all> [path] [--apply]',
    ],
    aliases: [],
  },
]);

const CHAT_HELP = `AHP+ chat operations

In a terminal:
  ahp project check
  ahp message send "Continue from the verified boundary" --from cursor --to codex --session project-chat
  ahp message inbox --for codex --session project-chat
  ahp message reply EVT-... "Received; verification passed" --from codex
  ahp relay send EVT-... --channel /shared/ahp-relay
  ahp relay wait --as codex --channel /shared/ahp-relay
  ahp relay confirm --as cursor --channel /shared/ahp-relay

In an IDE chat with an installed AHP+ adapter:
  /ahp project check
  /ahp message send to=codex text="Continue from the verified boundary"
  /ahp message inbox for=codex
  /ahp message reply EVT-... text="Received; verification passed"
  /ahp relay send EVT-... channel="/shared/ahp-relay"
  /ahp relay wait as=codex channel="/shared/ahp-relay"
  /ahp relay confirm as=cursor channel="/shared/ahp-relay"
  /ahp agent ask claude question="Review the current implementation without editing files"

The adapter must execute the repository-installed CLI and report its actual output.
A local message has a fingerprint but does not prove delivery. Only a valid RCP receipt proves that the authenticated relay receiver imported it.`;

export function commandCatalog() {
  return {
    schema_version: '1.0.0',
    cli_version: CLI_VERSION,
    syntax: 'ahp <category> <action> [target] [options]',
    categories: CATEGORIES,
    compatibility: 'Legacy AHP+ 1.2 commands remain supported as aliases.',
    authority: 'No command grants commit, push, pull, merge, deploy, publication, deletion, payment, or secret access authority.',
  };
}

function renderCategory(category) {
  return `${category.name.toUpperCase()} — ${category.purpose}\n\n${category.commands.map((command) => `  ${command}`).join('\n')}${category.aliases.length ? `\n\nLegacy aliases: ${category.aliases.join(', ')}` : ''}`;
}

export function helpText(categoryName = null) {
  if (categoryName === 'chat') return CHAT_HELP;
  if (categoryName) {
    const category = CATEGORIES.find((item) => item.name === categoryName);
    return category ? `AHP+ ${CLI_VERSION} command catalog\n\n${renderCategory(category)}` : null;
  }
  return `AHP+ ${CLI_VERSION} command catalog

Syntax:
  ahp <category> <action> [target] [options]

Start here:
  ahp setup
  ahp project check
  ahp session context --format markdown
  ahp message send "Continue from the verified boundary" --to codex
  ahp help message
  ahp help relay

Durable collaboration:
  ahp session checkpoint --summary TEXT --platform PLATFORM --actor ACTOR
  ahp handoff create --to PLATFORM --session ID

Categories:
${CATEGORIES.map((category) => `  ${category.name.padEnd(9)} ${category.purpose}`).join('\n')}

IDE chat:
  ahp help chat

Machine-readable catalog:
  ahp catalog --format json

Legacy AHP+ 1.2 commands remain supported as aliases.
All writes accept --expected-head COMMIT and --expected-state DIGEST.
AHP+ never runs Git network or publication commands.`;
}

const PROJECT_ALIASES = Object.freeze({
  init: 'init',
  root: 'root',
  doctor: 'doctor',
  verify: 'verify',
  status: 'status',
  ready: 'ready',
  state: 'set-state',
  upgrade: 'upgrade',
});

const SESSION_ALIASES = Object.freeze({
  context: 'context',
  brief: 'brief',
  checkpoint: 'checkpoint',
  history: 'history',
});

export function normalizeCategorizedCommand(positionals) {
  const [category, action, ...rest] = positionals;
  if (category === 'project' && PROJECT_ALIASES[action]) return [PROJECT_ALIASES[action], ...rest];
  if (category === 'session' && SESSION_ALIASES[action]) return [SESSION_ALIASES[action], ...rest];
  if (category === 'record') {
    if (action === 'add') return ['record', ...rest];
    if (action === 'list') return ['list', ...rest];
    if (action === 'close') return ['close', ...rest];
    if (action === 'supersede') return ['supersede', ...rest];
  }
  return positionals;
}

export function categoryNames() {
  return [...CATEGORIES.map((category) => category.name), 'chat'];
}
