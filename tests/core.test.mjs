import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  cli,
  commitAll,
  createGitRepository,
  git,
  initializeAhp,
  jsonAhp,
  removeTemporary,
  runAhp,
  temporaryDirectory,
} from './helpers.mjs';
import { consultAgent, handleMcpRequest } from '../src/live.mjs';
import { waitForConversationMessage } from '../src/conversations.mjs';
import {
  confirmSecureNetworkReceipts,
  pushSecureNetworkEnvelope,
  receiveSecureNetworkEnvelopes,
  sendSecureNetworkEnvelope,
} from '../src/secure-network.mjs';
import { createSecureHub } from '../src/hub.mjs';

test('CLI reports the package version', () => {
  for (const argv of [['version'], ['--version']]) {
    const result = runAhp(process.cwd(), argv);
    assert.equal(result.stdout.trim(), '1.4.0');
  }
});

test('setup initializes and configures a project in one idempotent command', (context) => {
  const temporary = temporaryDirectory('ahp-setup-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));

  const identityStore = path.join(temporary, 'private-identities');
  const first = jsonAhp(repo, ['setup', '--platforms', 'codex,claude', '--store', identityStore, '--no-install']);
  assert.equal(first.ok, true);
  assert.equal(first.status, 'AHP_READY');
  assert.equal(first.initialized, true);
  assert.equal(first.owner, 'AHP Test');
  assert.equal(first.package.status, 'SKIPPED');
  assert.equal(first.identities.length, 2);
  assert.ok(first.identities.every((identity) => identity.status === 'CREATED'));
  assert.ok(first.applied.includes('AGENTS.md'));
  assert.ok(first.applied.includes('CLAUDE.md'));
  assert.ok(first.applied.includes('.agents/skills/ahp/SKILL.md'));
  assert.ok(first.applied.includes('.mcp.json'));
  assert.ok(first.applied.includes('.codex/config.toml'));
  assert.equal(first.unchanged.some((entry) => first.applied.includes(entry)), false);
  const claudeMcp = JSON.parse(fs.readFileSync(path.join(repo, '.mcp.json'), 'utf8'));
  assert.equal(claudeMcp.mcpServers.ahp.command, 'npx');
  assert.match(fs.readFileSync(path.join(repo, '.codex/config.toml'), 'utf8'), /\[mcp_servers\.ahp\]/);

  const second = jsonAhp(repo, ['setup', '--platforms', 'codex,claude', '--store', identityStore, '--no-install']);
  assert.equal(second.ok, true);
  assert.equal(second.initialized, false);
  assert.ok(second.identities.every((identity) => identity.status === 'PRESENT'));
  assert.deepEqual(second.applied, []);
  assert.ok(second.unchanged.includes('CLAUDE.md'));
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});

test('live bridge records a bounded fingerprinted consultation and exposes it through MCP', async (context) => {
  const temporary = temporaryDirectory('ahp-live-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'live-consult');
  commitAll(repo, 'test: initialize live consultation');
  const invoke = async ({ target, prompt }) => ({
    text: `${target} reviewed the bounded prompt (${prompt.length} chars)`,
    session_id: 'provider-session-test',
  });

  const consultation = await consultAgent(repo, {
    target: 'codex',
    from: 'claude',
    question: 'Review the current project state without editing files.',
    model: 'haiku',
    invoke,
  });
  assert.equal(consultation.ok, true);
  assert.equal(consultation.status, 'CONSULTED');
  assert.equal(consultation.mode, 'read-only');
  assert.equal(consultation.hop_limit, 1);
  assert.equal(consultation.requested_target_model, 'haiku');
  assert.match(consultation.request.event_id, /^EVT-/);
  assert.match(consultation.response.event_id, /^EVT-/);
  assert.notEqual(consultation.request.fingerprint, consultation.response.fingerprint);
  const requestEvent = jsonAhp(repo, ['message', 'verify', consultation.request.event_id]).event;
  assert.equal(requestEvent.actor.model, 'unknown');
  assert.equal(jsonAhp(repo, ['message', 'verify', consultation.response.event_id]).causal_parent_valid, true);

  const tools = await handleMcpRequest(repo, { method: 'tools/list', id: 1, params: {} });
  assert.ok(tools.tools.some((tool) => tool.name === 'ahp_consult'));
  assert.ok(tools.tools.some((tool) => tool.name === 'ahp_conversation_open'));
  const consultTool = tools.tools.find((tool) => tool.name === 'ahp_consult');
  assert.equal(consultTool.inputSchema.properties.max_budget_usd.maximum, 20);
  const called = await handleMcpRequest(repo, {
    method: 'tools/call',
    id: 2,
    params: {
      name: 'ahp_consult',
      arguments: {
        target: 'claude', from: 'codex', question: 'Give one review.', model: 'haiku', timeout: 30, max_budget_usd: 0.25,
      },
    },
  }, { invoke });
  assert.equal(called.structuredContent.status, 'CONSULTED');
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});

test('conversation rooms preserve participants, causal messages, and inbox boundaries', async (context) => {
  const temporary = temporaryDirectory('ahp-conversation-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'conversation-room');
  commitAll(repo, 'test: initialize conversation room');

  const opened = jsonAhp(repo, [
    'conversation', 'open', 'Cross-platform architecture review',
    '--participants', 'codex,claude,cursor', '--from', 'codex',
  ]);
  assert.equal(opened.status, 'OPEN');
  assert.match(opened.room.room_id, /^conv-/);
  assert.deepEqual(opened.room.participants, ['codex', 'claude', 'cursor']);
  const listed = jsonAhp(repo, ['conversation', 'list', '--for', 'claude']);
  assert.equal(listed.count, 1);
  assert.equal(listed.rooms[0].room_id, opened.room.room_id);

  const sent = jsonAhp(repo, [
    'conversation', 'send', opened.room.room_id, 'Please assess the migration risk.', '--from', 'codex', '--to', 'claude',
  ]);
  assert.equal(sent.status, 'POSTED');
  assert.equal(sent.message.sequence, 2);
  assert.equal(sent.message.parent_event_id, opened.room.open_event_id);

  const claudeInbox = jsonAhp(repo, ['conversation', 'inbox', opened.room.room_id, '--for', 'claude']);
  assert.equal(claudeInbox.status, 'MESSAGES_AVAILABLE');
  assert.equal(claudeInbox.count, 1);
  assert.equal(claudeInbox.messages[0].event_id, sent.message.event_id);
  const cursorInbox = jsonAhp(repo, ['conversation', 'inbox', opened.room.room_id, '--for', 'cursor']);
  assert.equal(cursorInbox.status, 'EMPTY');

  const reply = jsonAhp(repo, [
    'conversation', 'send', opened.room.room_id, 'Risk is stale protocol metadata after CI.', '--from', 'claude', '--to', 'codex',
  ]);
  const verified = jsonAhp(repo, ['message', 'verify', reply.message.event_id]);
  assert.equal(verified.causal_parent_valid, true);
  const codexInbox = jsonAhp(repo, ['conversation', 'inbox', opened.room.room_id, '--for', 'codex', '--after', sent.message.event_id]);
  assert.equal(codexInbox.count, 1);
  assert.equal(codexInbox.messages[0].event_id, reply.message.event_id);

  const timedOut = await waitForConversationMessage(repo, opened.room.room_id, {
    for: 'cursor', timeout: 0.2, interval: 0.2,
  });
  assert.equal(timedOut.status, 'TIMEOUT');

  const waiting = waitForConversationMessage(repo, opened.room.room_id, {
    for: 'cursor', timeout: 2, interval: 0.2,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const delayed = jsonAhp(repo, [
    'conversation', 'send', opened.room.room_id, 'Message delivered during an active wait.', '--from', 'codex', '--to', 'cursor',
  ]);
  const arrived = await waiting;
  assert.equal(arrived.status, 'MESSAGE_AVAILABLE');
  assert.equal(arrived.count, 1);
  assert.equal(arrived.messages[0].event_id, delayed.message.event_id);

  const mcpOpened = await handleMcpRequest(repo, {
    method: 'tools/call', id: 8, params: {
      name: 'ahp_conversation_open',
      arguments: { title: 'MCP room', participants: 'codex,claude', from: 'codex' },
    },
  });
  const mcpRoom = mcpOpened.structuredContent.room.room_id;
  const mcpSent = await handleMcpRequest(repo, {
    method: 'tools/call', id: 9, params: {
      name: 'ahp_conversation_send',
      arguments: { room_id: mcpRoom, text: 'Visible in Claude MCP.', from: 'codex' },
    },
  });
  assert.equal(mcpSent.structuredContent.status, 'POSTED');
  const mcpInbox = await handleMcpRequest(repo, {
    method: 'tools/call', id: 10, params: {
      name: 'ahp_conversation_inbox', arguments: { room_id: mcpRoom, for: 'claude' },
    },
  });
  assert.equal(mcpInbox.structuredContent.messages[0].text, 'Visible in Claude MCP.');
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});

test('live status discovers a standard Claude installation outside PATH when present', () => {
  const status = runAhp(process.cwd(), ['live', 'status']);
  assert.equal(status.status, 0);
  const value = JSON.parse(status.stdout);
  const standard = path.join(process.env.HOME || '', '.local', 'bin', 'claude');
  if (fs.existsSync(standard)) {
    assert.equal(value.providers.claude.available, true);
    assert.equal(value.providers.claude.command, standard);
  }
});

test('live bridge records a causal error when a provider does not answer', async (context) => {
  const temporary = temporaryDirectory('ahp-live-failure-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'live-failure');
  await assert.rejects(
    () => consultAgent(repo, {
      target: 'claude',
      from: 'codex',
      question: 'Review read-only.',
      invoke: async () => { throw new Error('provider timed out'); },
    }),
    (error) => error.code === 'PROVIDER_CONSULTATION_FAILED' && Boolean(error.details?.failure_event_id),
  );
  const events = jsonAhp(repo, ['event', 'list']);
  assert.equal(events.count, 2);
  assert.equal(events.events[1].event_type, 'ERROR');
  assert.equal(events.events[1].causal.parent_event_id, events.events[0].id);
});

test('device identities keep private keys outside the project and seal public keys', (context) => {
  const temporary = temporaryDirectory('ahp-identity-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'device-identity');
  const store = path.join(temporary, 'private-store');
  const created = jsonAhp(repo, [
    'identity', 'create', '--name', 'Codex laptop', '--platform', 'codex', '--store', store,
  ]);
  assert.equal(created.ok, true);
  assert.equal(created.assurance, 'device-key-pair');
  assert.equal(created.private_persisted_in_project, false);
  assert.equal(created.private_file.startsWith(repo), false);
  assert.equal(fs.existsSync(created.private_file), true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(created.private_file).mode & 0o077, 0);
  const inspected = jsonAhp(repo, ['identity', 'verify', created.device_id]);
  assert.equal(inspected.integrity_valid, true);
  assert.equal(jsonAhp(repo, ['identity', 'list']).count, 1);
  const unsafe = runAhp(repo, [
    'identity', 'create', '--name', 'Unsafe device', '--platform', 'codex',
    '--private-file', path.join(repo, '.ahp', 'unsafe.private.json'),
  ], { expect: 2 });
  assert.match(unsafe.stderr, /PRIVATE_KEY_IN_PROJECT/);
});

test('secure relay encrypts events, authenticates devices, and confirms delivery', (context) => {
  const temporary = temporaryDirectory('ahp-secure-');
  context.after(() => removeTemporary(temporary));
  const source = createGitRepository(path.join(temporary, 'source'));
  initializeAhp(source, 'secure-relay');
  const store = path.join(temporary, 'private-store');
  const codex = jsonAhp(source, [
    'identity', 'create', '--name', 'Codex device', '--platform', 'codex', '--store', store,
  ]);
  const claude = jsonAhp(source, [
    'identity', 'create', '--name', 'Claude device', '--platform', 'claude', '--store', store,
  ]);
  commitAll(source, 'test: establish device identities');
  const receiver = path.join(temporary, 'receiver');
  git(temporary, 'clone', source, receiver);
  const channel = path.join(temporary, 'channel');
  const event = jsonAhp(source, [
    'message', 'send', 'Sensitive project consultation', '--from', 'codex', '--to', 'claude', '--session', 'secure-chat',
  ]);
  const sent = jsonAhp(source, [
    'secure', 'send', event.id,
    '--from-device', codex.device_id,
    '--to-device', claude.device_id,
    '--channel', channel,
    '--store', store,
  ]);
  assert.equal(sent.encrypted, true);
  assert.equal(sent.identity_assurance, 'device-key-pair');
  const channelText = fs.readFileSync(sent.channel_file, 'utf8');
  assert.equal(channelText.includes('Sensitive project consultation'), false);
  const envelopeId = sent.id;
  assert.equal(jsonAhp(source, ['secure', 'verify', envelopeId]).signature_valid, true);

  const originalEnvelope = fs.readFileSync(sent.channel_file, 'utf8');
  const tamperedEnvelope = JSON.parse(originalEnvelope);
  tamperedEnvelope.payload.ciphertext = `${tamperedEnvelope.payload.ciphertext[0] === 'A' ? 'B' : 'A'}${tamperedEnvelope.payload.ciphertext.slice(1)}`;
  fs.writeFileSync(sent.channel_file, `${JSON.stringify(tamperedEnvelope, null, 2)}\n`);
  const rejected = runAhp(receiver, [
    'secure', 'receive', '--as-device', claude.device_id, '--channel', channel, '--store', store,
  ], { expect: 3 });
  assert.match(rejected.stderr, /SECURE_ENVELOPE_INVALID/);
  fs.writeFileSync(sent.channel_file, originalEnvelope);

  const received = jsonAhp(receiver, [
    'secure', 'receive', '--as-device', claude.device_id, '--channel', channel, '--store', store,
  ]);
  assert.equal(received.status, 'RECEIVED');
  assert.equal(received.count, 1);
  assert.equal(received.received[0].event_fingerprint, event.fingerprint);
  assert.equal(jsonAhp(receiver, ['message', 'verify', event.id]).integrity_valid, true);

  const confirmed = jsonAhp(source, [
    'secure', 'confirm', '--as-device', codex.device_id, '--channel', channel,
  ]);
  assert.equal(confirmed.status, 'DELIVERY_CONFIRMED');
  assert.equal(confirmed.count, 1);
  const receipt = jsonAhp(source, ['secure', 'receipt', 'verify', confirmed.imported[0].receipt_id]);
  assert.equal(receipt.signature_valid, true);
  assert.equal(receipt.delivery_confirmed, true);
  assert.equal(receipt.identity_assurance, 'device-key-pair');
  assert.equal(jsonAhp(source, ['verify', '--strict']).ok, true);
  assert.equal(jsonAhp(receiver, ['verify', '--strict']).ok, true);
});

test('secure network carrier transfers encrypted messages and signed receipts', async (context) => {
  const temporary = temporaryDirectory('ahp-secure-network-');
  context.after(() => removeTemporary(temporary));
  const source = createGitRepository(path.join(temporary, 'source'));
  initializeAhp(source, 'secure-network');
  const store = path.join(temporary, 'private-store');
  const codex = jsonAhp(source, [
    'identity', 'create', '--name', 'Codex network device', '--platform', 'codex', '--store', store,
  ]);
  const claude = jsonAhp(source, [
    'identity', 'create', '--name', 'Claude network device', '--platform', 'claude', '--store', store,
  ]);
  commitAll(source, 'test: establish network identities');
  const receiver = path.join(temporary, 'receiver');
  git(temporary, 'clone', source, receiver);

  const tokenValue = 'test-only-network-token-32-bytes-minimum';
  const tokenFile = path.join(temporary, 'carrier.token');
  fs.writeFileSync(tokenFile, `${tokenValue}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(tokenFile, 0o600);
  const hubData = path.join(temporary, 'hub-data');
  const carrier = createSecureHub({ 'token-file': tokenFile, 'data-dir': hubData });
  await new Promise((resolve) => carrier.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => carrier.close(resolve)));
  const address = carrier.address();
  const url = `http://127.0.0.1:${address.port}`;

  const event = jsonAhp(source, [
    'message', 'send', 'Encrypted over a real HTTP carrier', '--from', 'codex', '--to', 'claude', '--session', 'network-chat',
  ]);
  const sent = await sendSecureNetworkEnvelope(source, event.id, {
    'from-device': codex.device_id,
    'to-device': claude.device_id,
    'token-file': tokenFile,
    url,
    store,
  });
  assert.equal(sent.status, 'REMOTE_AVAILABLE');
  assert.equal(sent.encrypted, true);
  const carrierFiles = fs.readdirSync(path.join(hubData, 'secure-network', claude.device_id.toLowerCase(), 'messages'));
  const carrierDirectory = path.join(hubData, 'secure-network', claude.device_id.toLowerCase(), 'messages');
  const carrierText = carrierFiles.map((file) => fs.readFileSync(path.join(carrierDirectory, file), 'utf8')).join('\n');
  assert.equal(carrierText.includes('Encrypted over a real HTTP carrier'), false);

  await assert.rejects(
    () => pushSecureNetworkEnvelope(source, sent.secure_envelope_id, {
      'token-file': tokenFile,
      url: `http://user:password@127.0.0.1:${address.port}`,
    }),
    /must not contain embedded credentials/,
  );

  const unsafeToken = path.join(temporary, 'unsafe-carrier.token');
  fs.writeFileSync(unsafeToken, `${tokenValue}\n`, { mode: 0o644 });
  if (process.platform !== 'win32') {
    await assert.rejects(
      () => pushSecureNetworkEnvelope(source, sent.secure_envelope_id, { 'token-file': unsafeToken, url }),
      /permissions are unsafe/,
    );
  }
  const insecureHub = runAhp(source, [
    'hub', 'serve', '--host', '0.0.0.0', '--data-dir', path.join(temporary, 'unsafe-hub'), '--token-file', tokenFile,
  ], { expect: 2 });
  assert.match(insecureHub.stderr, /INSECURE_TRANSPORT/);

  const carrierFile = path.join(carrierDirectory, carrierFiles[0]);
  const storedEnvelope = fs.readFileSync(carrierFile, 'utf8');
  const expiredEnvelope = JSON.parse(storedEnvelope);
  expiredEnvelope.delivery.expires_at = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(carrierFile, `${JSON.stringify(expiredEnvelope, null, 2)}\n`);
  const noExpiredDelivery = await receiveSecureNetworkEnvelopes(receiver, {
    'as-device': claude.device_id,
    'token-file': tokenFile,
    url,
    store,
  });
  assert.equal(noExpiredDelivery.status, 'NO_NEW_MESSAGES');
  fs.writeFileSync(carrierFile, storedEnvelope);

  const received = await receiveSecureNetworkEnvelopes(receiver, {
    'as-device': claude.device_id,
    'token-file': tokenFile,
    url,
    store,
  });
  assert.equal(received.status, 'RECEIVED');
  assert.equal(received.received[0].event_fingerprint, event.fingerprint);

  const confirmed = await confirmSecureNetworkReceipts(source, {
    'as-device': codex.device_id,
    'token-file': tokenFile,
    url,
  });
  assert.equal(confirmed.status, 'DELIVERY_CONFIRMED');
  assert.equal(confirmed.imported[0].event_id, event.id);
  assert.equal(jsonAhp(source, ['verify', '--strict']).ok, true);
  assert.equal(jsonAhp(receiver, ['verify', '--strict']).ok, true);
});

test('1.4 CLI catalogs commands by intent while preserving 1.2 aliases', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'intent-cli');
  commitAll(repo, 'test: initialize AHP state');

  const help = runAhp(repo, ['help']).stdout;
  assert.match(help, /ahp <category> <action>/);
  assert.match(help, /project\s+Initialize/);
  assert.match(help, /message\s+Create/);
  assert.match(help, /relay\s+Deliver/);
  assert.match(runAhp(repo, ['help', 'chat']).stdout, /\/ahp message send/);

  const catalog = jsonAhp(repo, ['catalog', '--format', 'json']);
  assert.ok(catalog.categories.some((category) => category.name === 'project'));
  assert.ok(catalog.categories.some((category) => category.name === 'message'));

  const legacy = jsonAhp(repo, ['status']);
  const categorized = jsonAhp(repo, ['project', 'status']);
  assert.equal(categorized.project_id, legacy.project_id);
  const check = jsonAhp(repo, ['project', 'check', '--platform', 'codex']);
  assert.equal(check.checks.strict_verification, 'PASS');
  assert.equal(check.checks.local_readiness, 'READY');

  const task = jsonAhp(repo, ['record', 'add', 'task', '--title', 'Intent-routed task']);
  assert.equal(task.kind, 'task');
  const tasks = jsonAhp(repo, ['record', 'list', 'task']);
  assert.equal(tasks.records[0].id, task.id);
});

test('message commands create, filter, reply to, and verify fingerprinted IDE chat capsules', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'message-cli');
  commitAll(repo, 'test: initialize AHP state');

  const sent = jsonAhp(repo, [
    'message', 'send', 'Continue from the verified boundary',
    '--from', 'cursor', '--to', 'codex', '--session', 'ide-chat',
  ]);
  assert.equal(sent.event_type, 'MESSAGE');
  assert.equal(sent.from, 'cursor');
  assert.equal(sent.to, 'codex');
  assert.deepEqual(sent.actor, { name: 'cursor', platform: 'cursor', model: 'unknown' });
  assert.equal(sent.next_action, 'Relay if authorized and await receiver evidence; local capture alone is not delivery');
  assert.match(sent.fingerprint, /^[a-f0-9]{64}$/);

  const inbox = jsonAhp(repo, ['message', 'inbox', '--for', 'codex', '--session', 'ide-chat']);
  assert.equal(inbox.count, 1);
  assert.equal(inbox.events[0].id, sent.id);
  const outbox = jsonAhp(repo, ['message', 'outbox', '--from', 'cursor', '--session', 'ide-chat']);
  assert.equal(outbox.count, 1);

  const reply = jsonAhp(repo, [
    'message', 'reply', sent.id, 'Received and verified', '--from', 'codex',
  ]);
  assert.equal(reply.session_id, 'ide-chat');
  assert.equal(reply.to, 'cursor');
  assert.deepEqual(reply.actor, { name: 'codex', platform: 'codex', model: 'unknown' });
  assert.equal(reply.causal.parent_event_id, sent.id);
  assert.equal(reply.causal.parent_fingerprint, sent.fingerprint);

  const cursorInbox = jsonAhp(repo, ['message', 'inbox', '--for', 'cursor']);
  assert.equal(cursorInbox.count, 1);
  assert.equal(cursorInbox.events[0].id, reply.id);
  assert.equal(jsonAhp(repo, ['message', 'verify', reply.id]).ok, true);
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});

test('message commands return actionable errors for missing text and destination', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'message-errors');

  const missingText = runAhp(repo, ['message', 'send', '--to', 'codex'], { expect: 1 });
  assert.match(missingText.stderr, /Message text is required/);
  const missingDestination = runAhp(repo, ['message', 'send', 'Continue'], { expect: 1 });
  assert.match(missingDestination.stderr, /--to is required/);
});

test('1.4 reads a 1.1 project and upgrades without rewriting sealed provenance', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'compatible-1.1');
  for (const relative of ['.ahp/manifest.json', '.ahp/state/project.json']) {
    const file = path.join(repo, relative);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.schema_version = '1.1.0';
    if (relative.endsWith('manifest.json')) value.protocol_version = '1.1.0';
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  const checkpoint = jsonAhp(repo, ['checkpoint', '--summary', 'Compatible history']);
  assert.equal(checkpoint.schema_version, '1.1.0');
  const verification = jsonAhp(repo, ['verify', '--strict']);
  assert.equal(verification.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.ahp/manifest.json'), 'utf8')).protocol_version, '1.1.0');
  const blockedEvent = runAhp(repo, ['event', 'append', '--type', 'MESSAGE', '--summary', 'Requires upgrade'], { expect: 2 });
  assert.match(blockedEvent.stderr, /Run `ahp upgrade \. --plan`/);
  const plan = jsonAhp(repo, ['upgrade', '--plan']);
  assert.equal(plan.from, '1.1.0');
  assert.equal(plan.to, '1.4.0');
  assert.equal(plan.preserves_sealed_history, true);
  const applied = jsonAhp(repo, ['upgrade', '--apply']);
  assert.equal(applied.mode, 'APPLY');
  assert.ok(applied.backup.startsWith('.ahp/backups/upgrade/'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.ahp/manifest.json'), 'utf8')).protocol_version, '1.4.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, checkpoint.file), 'utf8')).schema_version, '1.1.0');
  const event = jsonAhp(repo, ['event', 'append', '--type', 'MESSAGE', '--summary', 'New 1.4 event']);
  assert.equal(event.schema_version, '1.4.0');
});

test('1.4 preserves 1.3 message and HMAC relay compatibility while gating device keys', (context) => {
  const temporary = temporaryDirectory('ahp-compatible-13-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'compatible-1.3');
  for (const relative of ['.ahp/manifest.json', '.ahp/state/project.json']) {
    const file = path.join(repo, relative);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.schema_version = '1.3.0';
    if (relative.endsWith('manifest.json')) value.protocol_version = '1.3.0';
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  const event = jsonAhp(repo, ['message', 'send', 'Compatible relay', '--from', 'codex', '--to', 'claude']);
  assert.equal(event.schema_version, '1.3.0');
  const env = { AHP_RELAY_SECRET: 'compatible-relay-secret-at-least-32-bytes' };
  const envelope = jsonAhp(repo, ['relay', 'prepare', event.id], { env });
  assert.equal(envelope.schema_version, '1.3.0');
  assert.equal(jsonAhp(repo, ['relay', 'verify', envelope.id], { env }).ok, true);
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
  const blockedIdentity = runAhp(repo, [
    'identity', 'create', '--name', 'Requires upgrade', '--platform', 'codex', '--store', path.join(temporary, 'keys'),
  ], { expect: 2 });
  assert.match(blockedIdentity.stderr, /PROTOCOL_UPGRADE_REQUIRED/);
});

test('authenticated relay preserves message fingerprints and returns idempotent receiver receipts', (context) => {
  const temporary = temporaryDirectory('ahp-relay-');
  context.after(() => removeTemporary(temporary));
  const source = createGitRepository(path.join(temporary, 'source'));
  initializeAhp(source, 'relay-project');
  commitAll(source, 'test: initialize relay source');
  const receiver = path.join(temporary, 'receiver');
  git(temporary, 'clone', source, receiver);
  const channel = path.join(temporary, 'channel');
  const env = { AHP_RELAY_SECRET: 'relay-test-secret-with-at-least-32-bytes' };

  const sent = jsonAhp(source, [
    'message', 'send', 'Continue on the verified relay boundary',
    '--from', 'cursor', '--to', 'codex', '--session', 'realtime-chat',
  ]);
  const envelope = jsonAhp(source, ['relay', 'prepare', sent.id], { env });
  assert.match(envelope.id, /^RLY-/);
  assert.notEqual(envelope.fingerprint, sent.fingerprint);
  assert.equal(envelope.message.event_fingerprint, sent.fingerprint);
  assert.equal(jsonAhp(source, ['relay', 'verify', envelope.id], { env }).ok, true);
  const secretFile = path.join(temporary, 'relay.secret');
  fs.writeFileSync(secretFile, `${env.AHP_RELAY_SECRET}\n`);
  fs.chmodSync(secretFile, 0o600);
  assert.equal(jsonAhp(source, [
    'relay', 'verify', envelope.id, '--secret-file', secretFile,
  ]).authentication_valid, true);

  const pushed = jsonAhp(source, ['relay', 'push', envelope.id, '--channel', channel], { env });
  assert.equal(pushed.status, 'REMOTE_AVAILABLE');
  assert.equal(pushed.idempotent_duplicate, false);
  assert.equal(jsonAhp(source, ['relay', 'push', envelope.id, '--channel', channel], { env }).idempotent_duplicate, true);

  const pulled = jsonAhp(receiver, [
    'relay', 'pull', '--for', 'codex', '--channel', channel,
    '--actor', 'Codex receiver', '--platform', 'codex', '--model', 'test-model',
  ], { env });
  assert.equal(pulled.status, 'RECEIVED');
  assert.equal(pulled.count, 1);
  assert.equal(pulled.received[0].event_fingerprint, sent.fingerprint);
  assert.notEqual(pulled.received[0].receipt_fingerprint, sent.fingerprint);
  assert.equal(jsonAhp(receiver, ['message', 'verify', sent.id]).fingerprint, sent.fingerprint);
  assert.equal(jsonAhp(receiver, ['relay', 'pull', '--for', 'codex', '--channel', channel], { env }).count, 0);

  const receiptDirectory = path.join(channel, 'v1', 'relay-project', 'cursor', 'receipts');
  const receiptChannelFile = path.join(receiptDirectory, fs.readdirSync(receiptDirectory)[0]);
  const originalReceiptText = fs.readFileSync(receiptChannelFile, 'utf8');
  const tamperedReceipt = JSON.parse(originalReceiptText);
  tamperedReceipt.outcome = 'REJECTED';
  fs.writeFileSync(receiptChannelFile, `${JSON.stringify(tamperedReceipt, null, 2)}\n`);
  const rejectedReceipt = runAhp(source, [
    'relay', 'receipts', '--for', 'cursor', '--channel', channel,
  ], { expect: 3, env });
  assert.match(rejectedReceipt.stderr, /RELAY_RECEIPT_INVALID/);
  fs.writeFileSync(receiptChannelFile, originalReceiptText);

  const receiptSync = jsonAhp(source, [
    'relay', 'confirm', '--as', 'cursor', '--channel', channel,
  ], { env });
  assert.equal(receiptSync.count, 1);
  const receiptId = receiptSync.imported[0].receipt_id;
  const receipt = jsonAhp(source, ['relay', 'receipt', 'verify', receiptId], { env });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.envelope_matches, true);
  assert.equal(receipt.receiver_matches_destination, true);
  assert.equal(receipt.identity_assurance, 'project-shared-secret');
  assert.equal(jsonAhp(source, ['relay', 'receipts', '--for', 'cursor', '--channel', channel], { env }).count, 0);
  assert.equal(jsonAhp(source, ['verify', '--strict']).ok, true);
  assert.equal(jsonAhp(receiver, ['verify', '--strict']).ok, true);

  const wrongSecret = jsonAhp(source, ['relay', 'verify', envelope.id], {
    expect: 3,
    env: { AHP_RELAY_SECRET: 'different-relay-secret-with-32-plus-bytes' },
  });
  assert.equal(wrongSecret.ok, false);
  assert.equal(wrongSecret.authentication_valid, false);
});

test('relay rejects tampered channel payloads and watch times out without losing the spool', (context) => {
  const temporary = temporaryDirectory('ahp-relay-tamper-');
  context.after(() => removeTemporary(temporary));
  const source = createGitRepository(path.join(temporary, 'source'));
  initializeAhp(source, 'relay-tamper');
  commitAll(source, 'test: initialize relay source');
  const receiver = path.join(temporary, 'receiver');
  git(temporary, 'clone', source, receiver);
  const channel = path.join(temporary, 'channel');
  const env = { AHP_RELAY_SECRET: 'relay-test-secret-with-at-least-32-bytes' };

  const timeout = jsonAhp(receiver, [
    'relay', 'wait', '--as', 'codex', '--channel', channel, '--timeout', '0',
  ], { env });
  assert.equal(timeout.status, 'TIMEOUT');

  const sent = jsonAhp(source, [
    'message', 'send', 'Untampered content', '--from', 'cursor', '--to', 'codex', '--session', 'tamper-chat',
  ]);
  const pushed = jsonAhp(source, ['relay', 'send', sent.id, '--channel', channel], { env });
  const channelEnvelope = JSON.parse(fs.readFileSync(pushed.channel_file, 'utf8'));
  channelEnvelope.payload.summary = 'Tampered content';
  fs.writeFileSync(pushed.channel_file, `${JSON.stringify(channelEnvelope, null, 2)}\n`);

  const rejected = runAhp(receiver, [
    'relay', 'receive', '--as', 'codex', '--channel', channel,
  ], { expect: 3, env });
  assert.match(rejected.stderr, /RELAY_INVALID/);
  assert.equal(fs.existsSync(path.join(receiver, '.ahp/events/tamper-chat', `${sent.id}.json`)), false);
});

test('relay orders causal batches and refuses a child when its parent is unavailable', (context) => {
  const temporary = temporaryDirectory('ahp-relay-causal-');
  context.after(() => removeTemporary(temporary));
  const source = createGitRepository(path.join(temporary, 'source'));
  initializeAhp(source, 'relay-causal');
  commitAll(source, 'test: initialize relay source');
  const receiver = path.join(temporary, 'receiver');
  const incompleteReceiver = path.join(temporary, 'incomplete-receiver');
  git(temporary, 'clone', source, receiver);
  git(temporary, 'clone', source, incompleteReceiver);
  const channel = path.join(temporary, 'channel');
  const incompleteChannel = path.join(temporary, 'incomplete-channel');
  const env = { AHP_RELAY_SECRET: 'relay-test-secret-with-at-least-32-bytes' };

  const parent = jsonAhp(source, [
    'message', 'send', 'Parent message', '--from', 'cursor', '--to', 'codex', '--session', 'causal-relay',
  ]);
  const child = jsonAhp(source, [
    'message', 'reply', parent.id, 'Child message', '--from', 'cursor', '--to', 'codex',
  ]);
  const parentEnvelope = jsonAhp(source, ['relay', 'prepare', parent.id], { env });
  const childEnvelope = jsonAhp(source, ['relay', 'prepare', child.id], { env });
  const parentPush = jsonAhp(source, ['relay', 'push', parentEnvelope.id, '--channel', channel], { env });
  const childPush = jsonAhp(source, ['relay', 'push', childEnvelope.id, '--channel', channel], { env });
  const directory = path.dirname(parentPush.channel_file);
  fs.renameSync(childPush.channel_file, path.join(directory, '00-child.json'));
  fs.renameSync(parentPush.channel_file, path.join(directory, '01-parent.json'));

  const received = jsonAhp(receiver, ['relay', 'receive', '--as', 'codex', '--channel', channel], { env });
  assert.equal(received.count, 2);
  assert.deepEqual(received.received.map((item) => item.event_id), [parent.id, child.id]);
  assert.equal(jsonAhp(receiver, ['verify', '--strict']).ok, true);

  jsonAhp(source, ['relay', 'push', childEnvelope.id, '--channel', incompleteChannel], { env });
  const missingParent = runAhp(incompleteReceiver, [
    'relay', 'receive', '--as', 'codex', '--channel', incompleteChannel,
  ], { expect: 3, env });
  assert.match(missingParent.stderr, /MISSING_CAUSAL_PARENT/);
});

test('CLI rejects unknown options and explains lifecycle enums', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'cli-contract');

  const unknown = runAhp(repo, ['status', '--platfrom', 'codex'], { expect: 1 });
  assert.match(unknown.stderr, /Unknown option for status: --platfrom/);
  const invalidPhase = runAhp(repo, ['set-state', '--phase', 'HUNK2_PREFLIGHT'], { expect: 1 });
  assert.match(invalidPhase.stderr, /Allowed phases: DISCOVERY, PLANNED, IN_PROGRESS/);
  assert.match(invalidPhase.stderr, /Use --objective for a work-unit identifier/);
  const help = runAhp(repo, ['--help']).stdout;
  assert.match(help, /checkpoint.*--platform PLATFORM --actor ACTOR/);
  assert.match(help, /handoff create.*--session ID/);
});

test('doctor exposes Git diagnostics and ready separates local from transport readiness', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'field-readiness');
  commitAll(repo, 'test: initialize AHP state');

  const diagnostic = jsonAhp(repo, ['doctor', '--diagnose-git']);
  assert.equal(diagnostic.git_diagnostic.argv.join(' '), 'rev-parse --show-toplevel');
  assert.equal(diagnostic.git_diagnostic.exit_code, 0);
  const ready = jsonAhp(repo, ['ready', '--platform', 'codex']);
  assert.equal(ready.local_readiness.status, 'READY');
  assert.equal(ready.transport_readiness.status, 'BLOCKED');
  assert.equal(ready.transport_readiness.portability.status, 'PUSH_REQUIRED');
});

test('doctor gives an exact reviewed-head reconciliation command after onboarding drift', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'onboarding-drift');
  fs.writeFileSync(path.join(repo, 'package.json'), '{"private":true}\n');
  commitAll(repo, 'test: install package and AHP state');

  const diagnostic = jsonAhp(repo, ['doctor']);
  assert.match(diagnostic.verification.warnings[0], /base_commit is stale/);
  assert.match(diagnostic.recommendations[0].command, /set-state \. --accept-head --expected-head/);
  assert.match(diagnostic.recommendations[0].command, /--expected-state [a-f0-9]{64}$/);
  assert.equal(diagnostic.recommendations[0].authority_required, true);
});

test('continuity events form a sealed causal fingerprint chain', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'continuity-events');
  commitAll(repo, 'test: initialize AHP state');

  const directive = jsonAhp(repo, [
    'event', 'append', '--type', 'DIRECTIVE', '--session', 'cross-agent',
    '--from', 'claude', '--to', 'codex', '--actor', 'Claude', '--platform', 'claude',
    '--summary', 'Preserve the reconciliation boundary', '--status', 'REQUESTED',
    '--authority', 'USER_CONFIRMED',
  ]);
  const evidence = jsonAhp(repo, [
    'record', 'evidence', '--title', 'Recovered boundary', '--type', 'command',
    '--locator', 'ahp verify --strict', '--result', 'PASS', '--confidence', 'VERIFIED',
  ]);
  const observation = jsonAhp(repo, [
    'event', 'append', '--type', 'OBSERVATION', '--session', 'cross-agent',
    '--from', 'codex', '--to', 'claude', '--actor', 'Codex', '--platform', 'codex',
    '--summary', 'Boundary recovered from repository state', '--status', 'VERIFIED',
    '--evidence', evidence.id,
  ]);
  assert.equal(observation.sequence, 2);
  assert.equal(observation.causal.parent_event_id, directive.id);
  assert.equal(observation.causal.parent_fingerprint, directive.fingerprint);
  const inspected = jsonAhp(repo, ['event', 'verify', observation.id]);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.integrity_valid, true);
  assert.equal(inspected.causal_parent_valid, true);
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});

test('continuity events reject unsupported transport claims and unproven execution', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'continuity-claims');

  const remote = runAhp(repo, [
    'event', 'append', '--type', 'MESSAGE', '--summary', 'Claim remote delivery',
    '--transport', 'RECEIVED',
  ], { expect: 1 });
  assert.match(remote.stderr, /Remote states require an authenticated relay or independent receiver receipt/);
  const executed = runAhp(repo, [
    'event', 'append', '--type', 'ACTION', '--summary', 'Claim execution',
    '--status', 'EXECUTED',
  ], { expect: 1 });
  assert.match(executed.stderr, /EXECUTED continuity events require --evidence/);
});

test('continuity event tampering invalidates its fingerprint', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'continuity-tamper');
  const event = jsonAhp(repo, ['event', 'append', '--type', 'MESSAGE', '--summary', 'Original capsule']);
  const file = path.join(repo, event.file);
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  content.summary = 'Modified capsule';
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);

  const inspected = jsonAhp(repo, ['event', 'verify', event.id], { expect: 3 });
  assert.equal(inspected.integrity_valid, false);
  assert.equal(inspected.ok, false);
});

test('newer stable project state overrides an older checkpoint in effective status', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'effective-state');
  jsonAhp(repo, ['checkpoint', '--summary', 'Old checkpoint objective', '--objective', 'Old objective']);
  jsonAhp(repo, ['set-state', '--objective', 'New canonical objective', '--next-action', 'Follow new state']);

  const current = jsonAhp(repo, ['status']);
  assert.equal(current.objective, 'New canonical objective');
  assert.equal(current.next_action, 'Follow new state');
  assert.equal(current.latest_checkpoint.summary, 'Old checkpoint objective');
  assert.equal(current.effective_checkpoint, null);
});

test('repository resolution works from subdirectories', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'nested-resolution');
  const nested = path.join(repo, 'src/components');
  fs.mkdirSync(nested, { recursive: true });

  const root = jsonAhp(nested, ['root']);
  assert.equal(root.repoRoot, repo);
  assert.equal(root.layout, 'modern');
  const verification = jsonAhp(nested, ['verify', '--strict']);
  assert.equal(verification.ok, true);
});

test('a nested Git repository never borrows parent AHP+ state', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const parent = createGitRepository(path.join(temporary, 'parent'));
  initializeAhp(parent, 'parent');
  const child = createGitRepository(path.join(parent, 'child'));

  const root = jsonAhp(child, ['root']);
  assert.equal(root.repoRoot, child);
  assert.equal(root.layout, 'missing');
  const result = runAhp(child, ['status'], { expect: 2 });
  assert.match(result.stderr, /NOT_INITIALIZED/);
});

test('records, checkpoints, and handoffs remain sealed and receivable', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'handoff-flow');
  commitAll(repo, 'test: initialize AHP state');

  const evidence = jsonAhp(repo, [
    'record', 'evidence', '--title', 'Unit tests', '--type', 'test',
    '--locator', 'npm test', '--result', 'PASS', '--confidence', 'VERIFIED',
    '--actor', 'Tester', '--platform', 'node', '--model', 'n/a',
  ]);
  const qa = jsonAhp(repo, [
    'record', 'qa', '--title', 'Release gate', '--status', 'PASS',
    '--confidence', 'VERIFIED', '--source', evidence.id,
    '--actor', 'Tester', '--platform', 'node', '--model', 'n/a',
  ]);
  assert.equal(qa.source_refs[0], evidence.id);
  jsonAhp(repo, [
    'checkpoint', '--session', 'codex-test', '--summary', 'Core flow validated',
    '--next-action', 'Receive the handoff', '--files', 'src/cli.mjs',
    '--validations', qa.id, '--actor', 'Codex', '--platform', 'codex', '--model', 'test',
  ]);
  const handoff = jsonAhp(repo, [
    'handoff', 'create', '--from', 'codex', '--to', 'cursor',
    '--session', 'codex-test', '--summary', 'Continue verified fixture',
  ]);
  assert.equal(handoff.portability.status, 'PUSH_REQUIRED');
  const receipt = jsonAhp(repo, ['handoff', 'receive', handoff.id]);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.outcome, 'READY');
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});

test('tampering invalidates a handoff', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'tamper-test');
  commitAll(repo, 'test: initialize AHP state');
  const handoff = jsonAhp(repo, ['handoff', 'create', '--to', 'next-agent']);
  const file = path.join(repo, handoff.file);
  const content = JSON.parse(fs.readFileSync(file, 'utf8'));
  content.notes = 'tampered';
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);

  const inspection = jsonAhp(repo, ['handoff', 'inspect', handoff.id]);
  assert.equal(inspection.integrity_valid, false);
  const verification = runAhp(repo, ['verify', '--strict'], { expect: 2 });
  assert.match(verification.stdout, /integrity digest mismatch/);
});

test('stale state revisions and conflicting locks stop writes', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'concurrency');
  commitAll(repo, 'test: initialize AHP state');
  const revision = jsonAhp(repo, ['status']).state_revision;
  jsonAhp(repo, ['checkpoint', '--summary', 'Advance revision', '--actor', 'A']);
  const stale = runAhp(repo, [
    'record', 'task', '--title', 'Stale write', '--expected-state', revision,
  ], { expect: 3 });
  assert.match(stale.stderr, /STATE_CONFLICT/);

  const lock = jsonAhp(repo, ['lock', 'acquire', '--scope', 'record:task', '--owner', 'Agent A']);
  const conflict = runAhp(repo, [
    'record', 'task', '--title', 'Conflicting write', '--actor', 'Agent B',
  ], { expect: 3 });
  assert.match(conflict.stderr, /LOCK_CONFLICT/);
  const record = jsonAhp(repo, [
    'record', 'task', '--title', 'Owned write', '--actor', 'Agent A',
  ]);
  assert.equal(record.kind, 'task');
  const release = jsonAhp(repo, ['lock', 'release', lock.id, '--owner', 'Agent A']);
  assert.equal(release.released, lock.id);
});

test('dirty project changes are local-only while AHP-only changes require push', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'portability');
  commitAll(repo, 'test: initialize AHP state');
  assert.equal(jsonAhp(repo, ['status']).portability.status, 'PUSH_REQUIRED');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/index.js'), 'export const value = 1;\n');
  assert.equal(jsonAhp(repo, ['status']).portability.status, 'LOCAL_ONLY');

  fs.appendFileSync(path.join(repo, 'README.md'), '\nChanged after commit.\n');
  const gitState = jsonAhp(repo, ['status']).git;
  assert.ok(gitState.project_changed_files.some((entry) => entry.path === 'README.md' && entry.code === ' M'));
});

test('a shallow clone reports unavailable ancestry instead of stale state', (context) => {
  const temporary = temporaryDirectory();
  context.after(() => removeTemporary(temporary));
  const source = createGitRepository(path.join(temporary, 'source'));
  initializeAhp(source, 'shallow-history');
  commitAll(source, 'test: initialize AHP state');
  fs.writeFileSync(path.join(source, '.ahp/README.md'), '# AHP+ state\n\nEnvelope update.\n');
  commitAll(source, 'test: advance AHP envelope');

  const shallow = path.join(temporary, 'shallow');
  git(temporary, 'clone', '--depth', '1', `file://${source}`, shallow);
  const verification = jsonAhp(shallow, ['verify']);
  assert.equal(verification.ok, true);
  assert.ok(verification.warnings.some((warning) => warning.includes('is unavailable in this Git history')));
  const strict = runAhp(shallow, ['verify', '--strict'], { expect: 2 });
  assert.match(strict.stdout, /fetch sufficient history to verify ancestry/);
});
