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

test('CLI reports the development version', () => {
  for (const argv of [['version'], ['--version']]) {
    const result = runAhp(process.cwd(), argv);
    assert.equal(result.stdout.trim(), '1.2.0-dev.0');
  }
});

test('1.2 reads a 1.1 project without rewriting sealed provenance', (context) => {
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
  assert.equal(plan.to, '1.2.0');
  assert.equal(plan.preserves_sealed_history, true);
  const applied = jsonAhp(repo, ['upgrade', '--apply']);
  assert.equal(applied.mode, 'APPLY');
  assert.ok(applied.backup.startsWith('.ahp/backups/upgrade/'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.ahp/manifest.json'), 'utf8')).protocol_version, '1.2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, checkpoint.file), 'utf8')).schema_version, '1.1.0');
  const event = jsonAhp(repo, ['event', 'append', '--type', 'MESSAGE', '--summary', 'New 1.2 event']);
  assert.equal(event.schema_version, '1.2.0');
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
