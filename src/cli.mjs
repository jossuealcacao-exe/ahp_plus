import { assertKnownOptions, parseArgs } from './args.mjs';
import { categoryNames, commandCatalog, helpText, normalizeCategorizedCommand } from './command-catalog.mjs';
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
import { appendContinuityEvent, findContinuityEvent, inspectContinuityEvent, listContinuityEvents } from './events.mjs';
import { applyUpgrade, upgradePlan } from './upgrade.mjs';
import {
  inspectRelayEnvelope,
  inspectRelayReceipt,
  listRelayReceipts,
  prepareRelayEnvelope,
  pullRelayMessages,
  pushRelayEnvelope,
  syncRelayReceipts,
  watchRelayMessages,
} from './relay.mjs';
import { setupProject } from './setup.mjs';
import { consultAgent, liveStatus, serveMcp } from './live.mjs';
import {
  conversationInbox,
  listConversations,
  openConversation,
  sendConversationMessage,
  waitForConversationMessage,
} from './conversations.mjs';
import { createDeviceIdentity, inspectDeviceIdentity, listDeviceIdentities } from './identity.mjs';
import {
  confirmSecureReceipts,
  inspectSecureEnvelope,
  inspectSecureReceipt,
  prepareSecureEnvelope,
  pushSecureEnvelope,
  receiveSecureEnvelopes,
  sendSecureEnvelope,
} from './secure-relay.mjs';
import {
  confirmSecureNetworkReceipts,
  pushSecureNetworkEnvelope,
  receiveSecureNetworkEnvelopes,
  sendSecureNetworkEnvelope,
} from './secure-network.mjs';
import { serveSecureHub } from './hub.mjs';

const WRITE_OPTIONS = ['expected-head', 'expected-base', 'expected-state'];
const ACTOR_OPTIONS = ['actor', 'platform', 'model'];
const RELAY_AUTH_OPTIONS = ['secret-env', 'secret-file'];
const MESSAGE_WRITE_OPTIONS = [
  'text', 'summary', 'session', 'parent', 'correlation', 'from', 'to', 'capabilities',
  'requested', 'authority', 'status', 'result', 'evidence', 'artifacts', 'transport',
  'provider', 'privacy', 'redactions', 'limitations', 'next-action',
  ...ACTOR_OPTIONS, ...WRITE_OPTIONS,
];
const COMMAND_OPTIONS = Object.freeze({
  catalog: ['format'],
  setup: ['owner', 'project', 'platforms', 'replace', 'install', 'identity', 'store', 'phase', 'objective', 'next-action', 'confidence'],
  'live:status': [],
  'live:serve': [],
  'agent:ask': ['to', 'from', 'question', 'text', 'session', 'correlation', 'timeout', 'model', 'max-budget-usd', ...WRITE_OPTIONS],
  'conversation:open': ['title', 'summary', 'participants', 'from', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'conversation:list': ['for'],
  'conversation:send': ['text', 'summary', 'from', 'to', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'conversation:inbox': ['for', 'to', 'after', 'limit'],
  'conversation:wait': ['for', 'to', 'after', 'timeout', 'interval'],
  'identity:create': ['name', 'device', 'platform', 'actor', 'store', 'private-file', ...WRITE_OPTIONS],
  'identity:list': [],
  'identity:verify': [],
  'secure:prepare': ['from-device', 'to-device', 'store', 'private-file', 'ttl', ...WRITE_OPTIONS],
  'secure:send': ['from-device', 'to-device', 'store', 'private-file', 'ttl', 'channel', ...WRITE_OPTIONS],
  'secure:push': ['channel'],
  'secure:receive': ['as-device', 'store', 'private-file', 'channel', ...WRITE_OPTIONS],
  'secure:confirm': ['as-device', 'channel', ...WRITE_OPTIONS],
  'secure:verify': [],
  'secure:receipt-verify': [],
  'secure:network-send': ['from-device', 'to-device', 'store', 'private-file', 'ttl', 'url', 'token-file', ...WRITE_OPTIONS],
  'secure:network-push': ['url', 'token-file'],
  'secure:network-receive': ['as-device', 'store', 'private-file', 'url', 'token-file', ...WRITE_OPTIONS],
  'secure:network-confirm': ['as-device', 'url', 'token-file', ...WRITE_OPTIONS],
  'hub:serve': ['host', 'port', 'data-dir', 'token-file', 'tls-cert', 'tls-key'],
  'project:check': ['platform', 'diagnose-git', 'verbose'],
  'message:send': MESSAGE_WRITE_OPTIONS,
  'message:reply': MESSAGE_WRITE_OPTIONS,
  'message:inbox': ['for', 'to', 'session', 'from', 'limit'],
  'message:outbox': ['from', 'session', 'to', 'limit'],
  'message:list': ['from', 'to', 'session', 'limit'],
  'message:verify': [],
  'relay:prepare': [...RELAY_AUTH_OPTIONS, 'ttl', 'provider', ...WRITE_OPTIONS],
  'relay:send': [...RELAY_AUTH_OPTIONS, 'ttl', 'channel', ...WRITE_OPTIONS],
  'relay:push': [...RELAY_AUTH_OPTIONS, 'channel'],
  'relay:pull': [...RELAY_AUTH_OPTIONS, 'channel', 'for', 'to', 'as', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'relay:receive': [...RELAY_AUTH_OPTIONS, 'channel', 'for', 'to', 'as', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'relay:watch': [...RELAY_AUTH_OPTIONS, 'channel', 'for', 'to', 'as', 'timeout', 'interval', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'relay:wait': [...RELAY_AUTH_OPTIONS, 'channel', 'for', 'to', 'as', 'timeout', 'interval', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'relay:receipts': [...RELAY_AUTH_OPTIONS, 'channel', 'for', 'as', ...WRITE_OPTIONS],
  'relay:confirm': [...RELAY_AUTH_OPTIONS, 'channel', 'for', 'as', ...WRITE_OPTIONS],
  'relay:verify': RELAY_AUTH_OPTIONS,
  'relay:receipt-verify': RELAY_AUTH_OPTIONS,
  'relay:receipt-list': ['outcome', 'for', 'limit'],
  init: ['owner', 'project', 'phase', 'objective', 'next-action', 'confidence'],
  root: [],
  doctor: ['diagnose-git', 'verbose'],
  verify: ['strict'],
  status: [],
  ready: ['platform'],
  'event:append': ['type', 'summary', 'session', 'parent', 'correlation', 'from', 'to', 'capabilities', 'requested', 'authority', 'status', 'result', 'evidence', 'artifacts', 'transport', 'provider', 'privacy', 'redactions', 'limitations', 'next-action', ...ACTOR_OPTIONS, ...WRITE_OPTIONS],
  'event:list': ['session', 'type', 'from', 'to', 'limit'],
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
  if (command === 'relay' && action === 'receipt') return `relay:receipt-${positionals[2] || ''}`;
  if (command === 'secure' && action === 'receipt') return `secure:receipt-${positionals[2] || ''}`;
  if (command === 'secure' && action === 'network') return `secure:network-${positionals[2] || ''}`;
  if (['project', 'message', 'handoff', 'lock', 'adapter', 'sync', 'event', 'live', 'agent', 'conversation', 'identity', 'secure', 'hub'].includes(command)) return `${command}:${action || ''}`;
  if (command === 'relay') return `relay:${action || ''}`;
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

function projectCheck(input, options) {
  const diagnostic = doctor(input, options);
  const verification = verifyRepository(input, { strict: true });
  const current = status(input);
  const ready = readiness(input, options);
  const ok = diagnostic.ok && verification.ok && ready.local_readiness.status === 'READY';
  return {
    ok,
    project_id: current.project_id,
    checks: {
      doctor: diagnostic.ok ? 'PASS' : 'FAIL',
      strict_verification: verification.ok ? 'PASS' : 'FAIL',
      local_readiness: ready.local_readiness.status,
      transport_readiness: ready.transport_readiness.status,
    },
    git: {
      branch: current.git.branch,
      commit: current.git.commit,
      working_tree: current.git.working_tree,
    },
    portability: current.portability,
    blockers: current.blockers,
    next_action: current.next_action,
  };
}

function messageText(options, positional) {
  return options.text || options.summary || positional || null;
}

function eventOptions(options, overrides) {
  const normalized = { ...options, ...overrides };
  delete normalized.text;
  delete normalized.for;
  return normalized;
}

function messageEventOptions(options, overrides = {}) {
  const origin = String(overrides.from || options.from || options.platform || 'current-agent');
  return eventOptions(options, {
    ...overrides,
    from: origin,
    actor: options.actor || origin,
    platform: options.platform || origin,
    model: options.model || 'unknown',
    'next-action': options['next-action']
      || 'Relay if authorized and await receiver evidence; local capture alone is not delivery',
  });
}

export async function run(argv) {
  const parsed = parseArgs(argv);
  const { options } = parsed;
  const requested = parsed.positionals;
  const requestedCommand = requested[0];
  if (requestedCommand === 'version' || options.version) return { value: CLI_VERSION, exitCode: 0 };
  if (!requestedCommand || requestedCommand === 'help' || options.help) {
    const category = requestedCommand === 'help' ? requested[1] : categoryNames().includes(requestedCommand) ? requestedCommand : null;
    const value = helpText(category);
    invariant(value, `Unknown help category ${category}`, { code: 'INVALID_ARGUMENT', details: { categories: categoryNames() } });
    return { value, exitCode: 0 };
  }
  if (requestedCommand === 'catalog') {
    assertKnownOptions(options, COMMAND_OPTIONS.catalog, 'catalog');
    return { value: options.format === 'json' ? commandCatalog() : helpText(), exitCode: 0 };
  }
  const positionals = normalizeCategorizedCommand(requested);
  const command = positionals[0];
  const key = commandKey(positionals);
  if (COMMAND_OPTIONS[key]) assertKnownOptions(options, COMMAND_OPTIONS[key], key);

  if (command === 'setup') {
    const value = setupProject(target(options, positionals[1]), options);
    return { value, exitCode: value.ok ? 0 : 2 };
  }
  if (command === 'live') {
    const action = positionals[1];
    if (action === 'status') return { value: liveStatus(target(options, positionals[2])), exitCode: 0 };
    if (action === 'serve') {
      await serveMcp(target(options, positionals[2]));
      return { value: null, exitCode: 0, silent: true };
    }
    throw new AhpError('Expected `live status` or `live serve`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'agent') {
    const action = positionals[1];
    if (action === 'ask') {
      const question = options.question || options.text || positionals[3];
      const value = await consultAgent(target(options), { ...options, target: options.to || positionals[2], question });
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    throw new AhpError('Expected `agent ask`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'conversation') {
    const action = positionals[1];
    if (action === 'open') {
      const titleFromOption = options.title || options.summary;
      const title = titleFromOption || positionals[2];
      const input = target(options, titleFromOption ? positionals[2] : positionals[3]);
      return { value: openConversation(input, { ...options, title }), exitCode: 0 };
    }
    if (action === 'list') return { value: listConversations(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'send') {
      const textFromOption = options.text || options.summary;
      const text = textFromOption || positionals[3];
      const input = target(options, textFromOption ? positionals[3] : positionals[4]);
      return { value: sendConversationMessage(input, positionals[2], text, options), exitCode: 0 };
    }
    if (action === 'inbox') return { value: conversationInbox(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    if (action === 'wait') return { value: await waitForConversationMessage(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    throw new AhpError('Expected `conversation open|list|send|inbox|wait`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'identity') {
    const action = positionals[1];
    if (action === 'create') return { value: createDeviceIdentity(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'list') return { value: listDeviceIdentities(target(options, positionals[2])), exitCode: 0 };
    if (action === 'verify') {
      const value = inspectDeviceIdentity(target(options, positionals[3]), positionals[2]);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    throw new AhpError('Expected `identity create`, `identity list`, or `identity verify`', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'hub') {
    invariant(positionals[1] === 'serve', 'Expected `hub serve`', { code: 'INVALID_ARGUMENT' });
    await serveSecureHub(options);
    return { value: null, exitCode: 0, silent: true };
  }
  if (command === 'secure') {
    const action = positionals[1];
    if (action === 'network') {
      const networkAction = positionals[2];
      if (networkAction === 'send') {
        return { value: await sendSecureNetworkEnvelope(target(options, positionals[4]), positionals[3], options), exitCode: 0 };
      }
      if (networkAction === 'push') {
        return { value: await pushSecureNetworkEnvelope(target(options, positionals[4]), positionals[3], options), exitCode: 0 };
      }
      if (networkAction === 'receive') {
        return { value: await receiveSecureNetworkEnvelopes(target(options, positionals[3]), options), exitCode: 0 };
      }
      if (networkAction === 'confirm') {
        return { value: await confirmSecureNetworkReceipts(target(options, positionals[3]), options), exitCode: 0 };
      }
      throw new AhpError('Expected `secure network send|push|receive|confirm`', { code: 'INVALID_ARGUMENT' });
    }
    if (action === 'prepare') return { value: prepareSecureEnvelope(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    if (action === 'send') return { value: sendSecureEnvelope(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    if (action === 'push') return { value: pushSecureEnvelope(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    if (action === 'receive') return { value: receiveSecureEnvelopes(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'confirm') return { value: confirmSecureReceipts(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'verify') {
      const value = inspectSecureEnvelope(target(options, positionals[3]), positionals[2]);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    if (action === 'receipt' && positionals[2] === 'verify') {
      const value = inspectSecureReceipt(target(options, positionals[4]), positionals[3]);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    throw new AhpError('Expected `secure prepare|send|push|receive|confirm|verify|receipt verify|network ...`', { code: 'INVALID_ARGUMENT' });
  }

  if (command === 'project') {
    if (positionals[1] === 'check') {
      const value = projectCheck(target(options, positionals[2]), options);
      return { value, exitCode: value.ok ? 0 : 2 };
    }
    throw new AhpError('Unknown project action. Run `ahp help project`.', { code: 'INVALID_ARGUMENT' });
  }

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
  if (command === 'message') {
    const action = positionals[1];
    if (action === 'send') {
      const summary = messageText(options, positionals[2]);
      invariant(summary, 'Message text is required. Example: ahp message send "Continue from the verified boundary" --to codex', { code: 'INVALID_ARGUMENT' });
      invariant(options.to, '--to is required for message send', { code: 'INVALID_ARGUMENT' });
      const value = appendContinuityEvent(target(options), messageEventOptions(options, { type: 'MESSAGE', summary }));
      return { value, exitCode: 0 };
    }
    if (action === 'reply') {
      const parentId = positionals[2];
      const summary = messageText(options, positionals[3]);
      invariant(parentId, 'Parent EVT-ID is required for message reply', { code: 'INVALID_ARGUMENT' });
      invariant(summary, 'Reply text is required. Example: ahp message reply EVT-... "Received"', { code: 'INVALID_ARGUMENT' });
      const input = target(options);
      const inspected = inspectContinuityEvent(input, parentId);
      invariant(inspected.ok, `Cannot reply to invalid event ${parentId}`, { code: 'INTEGRITY_ERROR', exitCode: 3 });
      const parent = findContinuityEvent(input, parentId).event;
      const value = appendContinuityEvent(input, messageEventOptions(options, {
        type: 'MESSAGE',
        summary,
        parent: parentId,
        session: options.session || parent.session_id,
        from: options.from || parent.to || options.platform,
        to: options.to || parent.from,
      }));
      return { value, exitCode: 0 };
    }
    if (action === 'inbox') {
      invariant(options.for || options.to, '--for is required for message inbox. Example: ahp message inbox --for codex', { code: 'INVALID_ARGUMENT' });
      const value = listContinuityEvents(target(options, positionals[2]), {
        ...options,
        type: 'MESSAGE',
        to: options.for || options.to,
      });
      return { value: { ...value, mailbox: 'inbox', for: options.for || options.to || null }, exitCode: 0 };
    }
    if (action === 'outbox') {
      invariant(options.from, '--from is required for message outbox. Example: ahp message outbox --from codex', { code: 'INVALID_ARGUMENT' });
      const value = listContinuityEvents(target(options, positionals[2]), { ...options, type: 'MESSAGE' });
      return { value: { ...value, mailbox: 'outbox', from: options.from || null }, exitCode: 0 };
    }
    if (action === 'list') {
      return { value: listContinuityEvents(target(options, positionals[2]), { ...options, type: 'MESSAGE' }), exitCode: 0 };
    }
    if (action === 'verify') {
      const value = inspectContinuityEvent(target(options, positionals[3]), positionals[2]);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    throw new AhpError('Unknown message action. Run `ahp help message`.', { code: 'INVALID_ARGUMENT' });
  }
  if (command === 'relay') {
    const action = positionals[1];
    if (action === 'send') {
      invariant(positionals[2], 'EVT-ID is required for relay send', { code: 'INVALID_ARGUMENT' });
      const input = target(options, positionals[3]);
      const envelope = prepareRelayEnvelope(input, positionals[2], options);
      const pushed = pushRelayEnvelope(input, envelope.id, options);
      return {
        value: {
          ok: true,
          status: pushed.status,
          event_id: envelope.message.event_id,
          event_fingerprint: envelope.message.event_fingerprint,
          envelope_id: envelope.id,
          envelope_fingerprint: envelope.fingerprint,
          destination: pushed.destination,
          channel_file: pushed.channel_file,
          idempotent_duplicate: pushed.idempotent_duplicate,
          receipt_status: 'PENDING',
        },
        exitCode: 0,
      };
    }
    if (action === 'prepare') {
      invariant(positionals[2], 'EVT-ID is required for relay prepare', { code: 'INVALID_ARGUMENT' });
      return { value: prepareRelayEnvelope(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    }
    if (action === 'push') {
      invariant(positionals[2], 'RLY-ID is required for relay push', { code: 'INVALID_ARGUMENT' });
      return { value: pushRelayEnvelope(target(options, positionals[3]), positionals[2], options), exitCode: 0 };
    }
    if (action === 'pull' || action === 'receive') return { value: pullRelayMessages(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'watch' || action === 'wait') return { value: await watchRelayMessages(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'receipts' || action === 'confirm') return { value: syncRelayReceipts(target(options, positionals[2]), options), exitCode: 0 };
    if (action === 'verify') {
      invariant(positionals[2], 'RLY-ID is required for relay verify', { code: 'INVALID_ARGUMENT' });
      const value = inspectRelayEnvelope(target(options, positionals[3]), positionals[2], options);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    if (action === 'receipt' && positionals[2] === 'verify') {
      invariant(positionals[3], 'RCP-ID is required for relay receipt verify', { code: 'INVALID_ARGUMENT' });
      const value = inspectRelayReceipt(target(options, positionals[4]), positionals[3], options);
      return { value, exitCode: value.ok ? 0 : 3 };
    }
    if (action === 'receipt' && positionals[2] === 'list') {
      return { value: listRelayReceipts(target(options, positionals[3]), options), exitCode: 0 };
    }
    throw new AhpError('Unknown relay action. Run `ahp help relay`.', { code: 'INVALID_ARGUMENT' });
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
  throw new AhpError(`Unknown command ${command}. Run \`ahp help\` or \`ahp catalog --format json\`.`, { code: 'UNKNOWN_COMMAND' });
}

export async function main(argv) {
  try {
    const result = await run(argv);
    if (!result.silent) output(result.value);
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
