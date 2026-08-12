import fs from 'node:fs';
import path from 'node:path';
import { AhpError } from './errors.mjs';
import { readJson, walkJson } from './fs-utils.mjs';
import { repository, stateRevision } from './state.mjs';
import { verifyRepository } from './validation.mjs';

function scopesOverlap(left, right) {
  return left === '*' || right === '*' || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function activeLocks(repositoryValue) {
  if (!fs.existsSync(repositoryValue.paths.locks)) return [];
  return walkJson(repositoryValue.paths.locks)
    .map((file) => ({ file, lock: readJson(file) }))
    .filter(({ lock }) => Number.isFinite(Date.parse(lock.expires_at)) && Date.parse(lock.expires_at) > Date.now());
}

export function preflightWrite(input, options = {}, scope = 'state') {
  const verification = verifyRepository(input, { strict: false });
  if (!verification.ok) {
    throw new AhpError(`AHP+ verification failed: ${verification.errors.join('; ')}`, {
      code: 'INVALID_STATE',
      exitCode: 2,
      details: verification,
    });
  }
  if (verification.layout === 'legacy') {
    throw new AhpError('Legacy state is read-only. Run `ahp migrate --plan`.', {
      code: 'LEGACY_READ_ONLY',
      exitCode: 2,
    });
  }

  const repo = repository(input);
  const expectedHead = options['expected-head'] || options['expected-base'];
  if (expectedHead && expectedHead !== repo.git.commit) {
    throw new AhpError(`Git HEAD conflict: expected ${expectedHead}, current ${repo.git.commit || 'none'}`, {
      code: 'HEAD_CONFLICT',
      exitCode: 3,
    });
  }
  if (options['expected-state']) {
    const currentRevision = stateRevision(repo);
    if (options['expected-state'] !== currentRevision) {
      throw new AhpError(`AHP+ state conflict: expected ${options['expected-state']}, current ${currentRevision}`, {
        code: 'STATE_CONFLICT',
        exitCode: 3,
      });
    }
  }
  if (repo.projectState.confidence === 'CONFLICTED') {
    throw new AhpError('Project state is CONFLICTED; resolve it before writing.', {
      code: 'STATE_CONFLICT',
      exitCode: 3,
    });
  }

  const actor = options.actor || options.owner || 'AI agent';
  const conflicting = activeLocks(repo).find(({ lock }) => scopesOverlap(lock.scope, scope) && lock.owner !== actor);
  if (conflicting) {
    throw new AhpError(
      `Active lock ${conflicting.lock.id} on ${conflicting.lock.scope} is owned by ${conflicting.lock.owner} until ${conflicting.lock.expires_at}.`,
      { code: 'LOCK_CONFLICT', exitCode: 3 },
    );
  }
  return { repo, verification, state_revision: stateRevision(repo) };
}

export function recordFile(repositoryValue, kind, id) {
  const directory = kind === 'evidence'
    ? repositoryValue.paths.evidence
    : path.join(repositoryValue.paths.records, `${kind}s`.replace('qa' + 's', 'qa'));
  return path.join(directory, `${id}.json`);
}
