import fs from 'node:fs';
import path from 'node:path';
import { ID_PREFIXES } from './constants.mjs';
import { AhpError, invariant } from './errors.mjs';
import { ensureDirectory, makeId, now, readJson, writeJsonExclusive } from './fs-utils.mjs';
import { activeLocks, preflightWrite } from './preflight.mjs';
import { documentVersion } from './state.mjs';

function overlaps(left, right) {
  return left === '*' || right === '*' || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function acquireLock(input, options = {}) {
  const scope = String(options.scope || '*');
  const owner = String(options.owner || options.actor || '');
  invariant(owner, '--owner is required', { code: 'INVALID_ARGUMENT' });
  const { repo } = preflightWrite(input, { ...options, actor: owner }, scope);
  const conflict = activeLocks(repo).find(({ lock }) => overlaps(lock.scope, scope) && lock.owner !== owner);
  if (conflict) throw new AhpError(`Conflicting lock ${conflict.lock.id} owned by ${conflict.lock.owner}`, { code: 'LOCK_CONFLICT', exitCode: 3 });
  const minutes = Math.max(1, Math.min(1440, Number(options.minutes || 60)));
  const id = makeId(ID_PREFIXES.lock);
  const createdAt = now();
  const lock = {
    schema_version: documentVersion(repo),
    id,
    scope,
    owner,
    platform: String(options.platform || 'unknown'),
    purpose: String(options.purpose || ''),
    created_at: createdAt,
    expires_at: new Date(Date.parse(createdAt) + minutes * 60_000).toISOString(),
    base_commit: repo.git.commit,
  };
  writeJsonExclusive(path.join(repo.paths.locks, `${id}.json`), lock);
  return lock;
}

export function releaseLock(input, id, options = {}) {
  const { repo } = preflightWrite(input, options, `lock:${id}`);
  const file = path.join(repo.paths.locks, `${id}.json`);
  invariant(fs.existsSync(file), `Lock not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const lock = readJson(file);
  const owner = String(options.owner || options.actor || '');
  invariant(options.force || owner === lock.owner, `Lock belongs to ${lock.owner}; pass the matching --owner`, { code: 'AUTHORITY_REQUIRED', exitCode: 2 });
  const archiveDirectory = path.join(repo.paths.archive, 'locks');
  ensureDirectory(archiveDirectory);
  const archive = path.join(archiveDirectory, `${id}.json`);
  fs.renameSync(file, archive);
  return { released: id, scope: lock.scope, owner: lock.owner, archived_at: path.relative(repo.repoRoot, archive).split(path.sep).join('/'), released_at: now() };
}
