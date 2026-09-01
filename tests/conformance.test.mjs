import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  commitAll,
  createGitRepository,
  git,
  initializeAhp,
  jsonAhp,
  removeTemporary,
  temporaryDirectory,
} from './helpers.mjs';

test('a committed handoff is receivable from an independent clone', (context) => {
  const temporary = temporaryDirectory('ahp-conformance-');
  context.after(() => removeTemporary(temporary));
  const remote = path.join(temporary, 'remote.git');
  fs.mkdirSync(remote);
  git(remote, 'init', '--bare', '--initial-branch=main');
  const source = createGitRepository(path.join(temporary, 'source'));
  git(source, 'remote', 'add', 'origin', remote);
  git(source, 'push', '-u', 'origin', 'main');
  initializeAhp(source, 'portable-project');
  commitAll(source, 'test: add AHP state');
  git(source, 'push');
  assert.equal(jsonAhp(source, ['status']).portability.status, 'REMOTE_READY');

  jsonAhp(source, [
    'checkpoint', '--session', 'codex-portable', '--summary', 'Ready for another platform',
    '--next-action', 'Receive from the clone', '--actor', 'Codex', '--platform', 'codex', '--model', 'test',
  ]);
  const handoff = jsonAhp(source, [
    'handoff', 'create', '--from', 'codex', '--to', 'cursor', '--session', 'codex-portable',
  ]);
  const event = jsonAhp(source, [
    'event', 'append', '--type', 'HANDOFF', '--session', 'codex-portable',
    '--from', 'codex', '--to', 'cursor', '--summary', 'Handoff capsule created',
    '--status', 'NOT_APPLICABLE', '--artifacts', handoff.file,
  ]);
  assert.equal(handoff.portability.status, 'PUSH_REQUIRED');
  commitAll(source, 'test: publish AHP handoff envelope');
  git(source, 'push');

  const receiver = path.join(temporary, 'receiver');
  git(temporary, 'clone', remote, receiver);
  const verification = jsonAhp(receiver, ['verify', '--strict']);
  assert.equal(verification.ok, true);
  const receipt = jsonAhp(receiver, ['handoff', 'receive', handoff.id]);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.outcome, 'READY');
  const eventReceipt = jsonAhp(receiver, ['event', 'verify', event.id]);
  assert.equal(eventReceipt.ok, true);
  assert.equal(eventReceipt.fingerprint, event.fingerprint);
  assert.equal(jsonAhp(receiver, ['status']).portability.status, 'REMOTE_READY');
});

test('adapter installation is plan-first and idempotent', (context) => {
  const temporary = temporaryDirectory('ahp-conformance-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'project'));
  initializeAhp(repo, 'adapters');
  const plan = jsonAhp(repo, ['adapter', 'install', 'all']);
  assert.equal(plan.mode, 'PLAN');
  assert.equal(fs.existsSync(path.join(repo, 'AHP_INSTRUCTIONS.md')), false);
  const applied = jsonAhp(repo, ['adapter', 'install', 'all', '--apply']);
  assert.ok(applied.applied.includes('AHP_INSTRUCTIONS.md'));
  assert.ok(fs.existsSync(path.join(repo, '.agents/skills/ahp/SKILL.md')));
  const codexSkill = fs.readFileSync(path.join(repo, '.agents/skills/ahp/SKILL.md'), 'utf8');
  assert.match(codexSkill, /npx --no-install ahp/);
  assert.match(codexSkill, /node_modules\/.bin\/ahp\.cmd/);
  assert.ok(fs.existsSync(path.join(repo, '.cursor/commands/ahp.md')));
  assert.ok(fs.existsSync(path.join(repo, '.opencode/commands/ahp.md')));
  const second = jsonAhp(repo, ['adapter', 'install', 'all', '--apply']);
  assert.deepEqual(second.applied, []);
});

test('legacy migration preserves /agent and validates the modern copy', (context) => {
  const temporary = temporaryDirectory('ahp-conformance-');
  context.after(() => removeTemporary(temporary));
  const repo = createGitRepository(path.join(temporary, 'legacy'));
  const agent = path.join(repo, 'agent');
  fs.mkdirSync(path.join(agent, 'records/decisions'), { recursive: true });
  for (const directory of ['evidence', 'handoffs', 'locks']) fs.mkdirSync(path.join(agent, directory), { recursive: true });
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(agent, 'MANIFEST.json'), JSON.stringify({
    protocol: 'AHP+', version: '1.0.0', instance_id: 'legacy-fixture', created_at: timestamp,
    owner: 'Legacy Owner', root: 'agent', certainty_levels: ['VERIFIED', 'USER_CONFIRMED', 'INFERRED', 'UNVERIFIED', 'STALE', 'CONFLICTED'],
  }, null, 2));
  fs.writeFileSync(path.join(agent, 'CURRENT_STATE.json'), JSON.stringify({
    project_id: 'legacy-project', phase: 'DISCOVERY', objective: 'Migrate safely',
    next_action: 'Plan migration', confidence: 'USER_CONFIRMED', blockers: [], base_commit: git(repo, 'rev-parse', 'HEAD'),
  }, null, 2));
  fs.writeFileSync(path.join(agent, 'PROJECTS.json'), JSON.stringify({ schema_version: '1.0.0', projects: [] }, null, 2));
  fs.writeFileSync(path.join(agent, 'BACKLOG.json'), JSON.stringify({ schema_version: '1.0.0', items: [] }, null, 2));
  const decision = {
    id: 'DEC-20260812-ABCDEF12', kind: 'decision', project_id: 'legacy-project', title: 'Migrate',
    description: '', status: 'ACCEPTED', confidence: 'USER_CONFIRMED', created_at: timestamp,
    updated_at: timestamp, actor: { name: 'Owner', platform: 'human', model: 'n/a' },
    source_refs: ['user:approved'], base_commit: git(repo, 'rev-parse', 'HEAD'), tags: [],
  };
  fs.writeFileSync(path.join(agent, 'records/decisions', `${decision.id}.json`), JSON.stringify(decision, null, 2));

  const plan = jsonAhp(repo, ['migrate', '--plan']);
  assert.equal(plan.source_preserved, true);
  assert.equal(fs.existsSync(path.join(repo, '.ahp')), false);
  const applied = jsonAhp(repo, ['migrate', '--apply']);
  assert.equal(applied.source_preserved, true);
  assert.ok(fs.existsSync(path.join(repo, 'agent/MANIFEST.json')));
  assert.ok(fs.existsSync(path.join(repo, '.ahp/manifest.json')));
  assert.equal(jsonAhp(repo, ['verify', '--strict']).ok, true);
});
