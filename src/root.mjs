import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_STATE_DIRECTORY, STATE_DIRECTORY } from './constants.mjs';
import { AhpError } from './errors.mjs';
import { gitTopLevel } from './git.mjs';

function stateAt(repoRoot) {
  const modern = path.join(repoRoot, STATE_DIRECTORY);
  if (fs.existsSync(path.join(modern, 'manifest.json'))) {
    return { stateRoot: modern, layout: 'modern' };
  }
  const legacy = path.join(repoRoot, LEGACY_STATE_DIRECTORY);
  if (fs.existsSync(path.join(legacy, 'MANIFEST.json'))) {
    return { stateRoot: legacy, layout: 'legacy' };
  }
  return { stateRoot: modern, layout: 'missing' };
}

function directoryFrom(input) {
  const absolute = path.resolve(input || '.');
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return path.dirname(absolute);
  return absolute;
}

export function resolveRepository(input = '.', { requireState = true } = {}) {
  const start = directoryFrom(input);
  if (!fs.existsSync(start)) {
    throw new AhpError(`Path does not exist: ${start}`, { code: 'PATH_NOT_FOUND' });
  }

  const gitRoot = gitTopLevel(start);
  if (gitRoot) {
    const state = stateAt(gitRoot);
    if (requireState && state.layout === 'missing') {
      throw new AhpError(`AHP+ is not initialized in Git repository ${gitRoot}. Run \`ahp init\`.`, {
        code: 'NOT_INITIALIZED',
        exitCode: 2,
      });
    }
    return { repoRoot: gitRoot, ...state };
  }

  let cursor = start;
  while (true) {
    const state = stateAt(cursor);
    if (state.layout !== 'missing') return { repoRoot: cursor, ...state };
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  throw new AhpError(`No Git repository found from ${start}. AHP+ Core requires Git.`, {
    code: 'GIT_REQUIRED',
    exitCode: 2,
  });
}

export function statePaths(resolved) {
  return {
    manifest: path.join(resolved.stateRoot, resolved.layout === 'legacy' ? 'MANIFEST.json' : 'manifest.json'),
    projectState: path.join(resolved.stateRoot, resolved.layout === 'legacy' ? 'CURRENT_STATE.json' : 'state/project.json'),
    index: path.join(resolved.stateRoot, 'INDEX.md'),
    records: path.join(resolved.stateRoot, 'records'),
    evidence: path.join(resolved.stateRoot, 'evidence'),
    handoffs: path.join(resolved.stateRoot, 'handoffs'),
    events: path.join(resolved.stateRoot, 'events'),
    locks: path.join(resolved.stateRoot, 'locks'),
    sessions: path.join(resolved.stateRoot, 'sessions'),
    archive: path.join(resolved.stateRoot, 'archive'),
    backups: path.join(resolved.stateRoot, 'backups'),
  };
}
