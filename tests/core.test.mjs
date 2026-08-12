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

test('CLI reports the prerelease version', () => {
  const result = runAhp(process.cwd(), ['version']);
  assert.equal(result.stdout.trim(), '1.1.0-emancipation.0');
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
