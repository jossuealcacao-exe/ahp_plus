import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { relativeUnix } from './fs-utils.mjs';

export function runGit(cwd, args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function runGitRaw(cwd, args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).replace(/\r?\n$/, '');
  } catch {
    return fallback;
  }
}

export function gitTopLevel(cwd) {
  const root = runGit(cwd, ['rev-parse', '--show-toplevel'], null);
  return root ? path.resolve(root) : null;
}

function parseChangedFiles(status) {
  if (!status) return [];
  return status.split('\n').filter(Boolean).map((line) => {
    const code = line.slice(0, 2);
    const raw = line.slice(3);
    const file = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
    return { code, path: file.replaceAll(/^"|"$/g, '') };
  });
}

function isAhpStatePath(value) {
  return value === '.ahp' || value.startsWith('.ahp/');
}

const MANAGED_GITIGNORE_LINES = new Set([
  '# AHP+:BEGIN',
  '!.ahp/',
  '!.ahp/**',
  '.ahp/cache/',
  '.ahp/tmp/',
  '# AHP+:END',
]);

function commitFile(root, commit, file) {
  return runGit(root, ['show', `${commit}:${file}`], null);
}

function stripManagedGitignoreBlock(content) {
  if (content === null) return '';
  const lines = content.split('\n');
  const begin = lines.indexOf('# AHP+:BEGIN');
  const end = lines.indexOf('# AHP+:END', begin + 1);
  if (begin === -1 || end === -1) return content.trimEnd();
  const block = lines.slice(begin, end + 1);
  if (block.some((line) => !MANAGED_GITIGNORE_LINES.has(line))) return content.trimEnd();
  return [...lines.slice(0, begin), ...lines.slice(end + 1)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function gitignoreChangedOnlyByAhp(root, baseCommit, headCommit) {
  const base = commitFile(root, baseCommit, '.gitignore');
  const head = commitFile(root, headCommit, '.gitignore');
  if (head === null) return false;
  return stripManagedGitignoreBlock(head) === (base || '').trimEnd();
}

function digestWorkingTree(root, status, changedFiles, { excludeAhp = false } = {}) {
  const selected = excludeAhp ? changedFiles.filter((entry) => !isAhpStatePath(entry.path)) : changedFiles;
  const hash = crypto.createHash('sha256');
  const selectedStatus = status.split('\n').filter(Boolean).filter((line) => {
    const raw = line.slice(3);
    const file = raw.includes(' -> ') ? raw.split(' -> ').at(-1) : raw;
    return !excludeAhp || !isAhpStatePath(file.replaceAll(/^"|"$/g, ''));
  }).join('\n');
  hash.update(selectedStatus);
  const commit = runGit(root, ['rev-parse', 'HEAD'], null);
  if (commit) {
    const args = excludeAhp
      ? ['diff', '--binary', 'HEAD', '--', '.', ':(exclude).ahp/**']
      : ['diff', '--binary', 'HEAD'];
    hash.update(runGit(root, args, '') || '');
  }
  for (const entry of selected.filter((item) => item.code === '??')) {
    const file = path.join(root, entry.path);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      hash.update(entry.path);
      hash.update(fs.readFileSync(file));
    }
  }
  return hash.digest('hex');
}

function sanitizeRemote(value) {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return value.replace(/:\/\/[^/@]+@/, '://');
    }
  }
  return value.replace(/^[^@\s]+@([^:]+):/, '$1:');
}

export function gitState(cwd) {
  const root = gitTopLevel(cwd);
  if (!root) {
    return {
      is_git: false,
      root: null,
      branch: null,
      commit: null,
      tree: null,
      working_tree: 'UNKNOWN',
      changed_files: [],
      working_tree_digest: null,
      project_working_tree: 'UNKNOWN',
      project_changed_files: [],
      project_working_tree_digest: null,
      ahp_state_working_tree: 'UNKNOWN',
      ahp_state_changed_files: [],
      upstream: null,
      ahead: null,
      behind: null,
      remote: null,
    };
  }

  const commit = runGit(root, ['rev-parse', 'HEAD'], null);
  // Porcelain's leading column is significant (` M` means unstaged modification).
  // Do not trim the first character as the general Git helper intentionally does.
  const status = runGitRaw(root, ['status', '--porcelain=v1', '--untracked-files=all'], '');
  const upstream = runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], null);
  let ahead = null;
  let behind = null;
  if (upstream && commit) {
    const counts = runGit(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], null);
    if (counts) {
      const [left, right] = counts.split(/\s+/).map(Number);
      ahead = Number.isFinite(left) ? left : null;
      behind = Number.isFinite(right) ? right : null;
    }
  }

  const changedFiles = parseChangedFiles(status);
  const projectChangedFiles = changedFiles.filter((entry) => !isAhpStatePath(entry.path));
  const stateChangedFiles = changedFiles.filter((entry) => isAhpStatePath(entry.path));

  const remoteName = upstream?.includes('/') ? upstream.split('/')[0] : 'origin';
  const remote = sanitizeRemote(runGit(root, ['remote', 'get-url', remoteName], null));

  return {
    is_git: true,
    root,
    branch: runGit(root, ['branch', '--show-current'], null) || null,
    commit,
    tree: commit ? runGit(root, ['rev-parse', 'HEAD^{tree}'], null) : null,
    working_tree: status ? 'DIRTY' : 'CLEAN',
    changed_files: changedFiles,
    working_tree_digest: digestWorkingTree(root, status, changedFiles),
    project_working_tree: projectChangedFiles.length ? 'DIRTY' : 'CLEAN',
    project_changed_files: projectChangedFiles,
    project_working_tree_digest: digestWorkingTree(root, status, changedFiles, { excludeAhp: true }),
    ahp_state_working_tree: stateChangedFiles.length ? 'DIRTY' : 'CLEAN',
    ahp_state_changed_files: stateChangedFiles,
    upstream,
    ahead,
    behind,
    remote,
  };
}

export function gitCommitRelation(root, baseCommit, headCommit) {
  if (!baseCommit || !headCommit) return { relation: 'UNKNOWN', changed_files: [] };
  if (baseCommit === headCommit) return { relation: 'EXACT', changed_files: [] };
  if (runGit(root, ['cat-file', '-e', `${baseCommit}^{commit}`], null) === null) {
    return { relation: 'BASE_UNAVAILABLE', changed_files: [] };
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', baseCommit, headCommit], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    return { relation: 'DIVERGED', changed_files: [] };
  }
  const changed = runGit(root, ['diff', '--name-only', `${baseCommit}..${headCommit}`], '')
    .split('\n').filter(Boolean);
  const envelopeOnly = changed.every((file) => (
    isAhpStatePath(file)
    || (file === '.gitignore' && gitignoreChangedOnlyByAhp(root, baseCommit, headCommit))
  ));
  return {
    relation: envelopeOnly ? 'AHP_ENVELOPE_DESCENDANT' : 'PROJECT_DESCENDANT',
    changed_files: changed,
  };
}

export function gitTracked(root, file) {
  const relative = relativeUnix(root, file);
  return runGit(root, ['ls-files', '--error-unmatch', '--', relative], null) !== null;
}
