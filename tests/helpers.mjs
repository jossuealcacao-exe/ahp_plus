import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const cli = path.join(packageRoot, 'bin/ahp.mjs');

export function temporaryDirectory(prefix = 'ahp-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeTemporary(directory) {
  if (directory.startsWith(os.tmpdir())) fs.rmSync(directory, { recursive: true, force: true });
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function createGitRepository(root, { commit = true } = {}) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'AHP Test');
  git(root, 'config', 'user.email', 'ahp-test@example.invalid');
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  if (commit) commitAll(root, 'test: initialize fixture');
  return path.resolve(git(root, 'rev-parse', '--show-toplevel'));
}

export function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

export function runAhp(cwd, args, { expect = 0, env = {} } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.status !== expect) {
    throw new Error(`Expected AHP exit ${expect}, got ${result.status}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

export function jsonAhp(cwd, args, options) {
  const result = runAhp(cwd, args, options);
  return JSON.parse(result.stdout);
}

export function initializeAhp(root, project = 'fixture') {
  return jsonAhp(root, ['init', '--owner', 'Fixture Owner', '--project', project]);
}
