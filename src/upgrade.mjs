import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './constants.mjs';
import { invariant } from './errors.mjs';
import { compactTimestamp, ensureDirectory, now, relativeUnix, writeJsonAtomic } from './fs-utils.mjs';
import { preflightWrite } from './preflight.mjs';
import { repository, stateRevision } from './state.mjs';

export function upgradePlan(input = '.') {
  const repo = repository(input);
  const current = repo.manifest.protocol_version;
  invariant(SUPPORTED_PROTOCOL_VERSIONS.includes(current), `Unsupported protocol version ${current}`, {
    code: 'UNSUPPORTED_PROTOCOL', exitCode: 2, details: { current, supported: SUPPORTED_PROTOCOL_VERSIONS },
  });
  return {
    mode: 'PLAN',
    project_id: repo.manifest.project_id,
    from: current,
    to: PROTOCOL_VERSION,
    applicable: current !== PROTOCOL_VERSION,
    preserves_sealed_history: true,
    writes: current === PROTOCOL_VERSION ? [] : [
      '.ahp/manifest.json',
      '.ahp/state/project.json',
      '.ahp/events/',
    ],
    state_revision: stateRevision(repo),
    git_head: repo.git.commit,
    authority_required: true,
  };
}

export function applyUpgrade(input = '.', options = {}) {
  const plan = upgradePlan(input);
  invariant(options.apply, 'Upgrade is plan-only by default. Pass --apply after reviewing the plan.', {
    code: 'APPLY_REQUIRED', exitCode: 2,
  });
  if (!plan.applicable) return { ...plan, mode: 'UNCHANGED' };
  const { repo } = preflightWrite(input, options, 'protocol:upgrade');
  const timestamp = now();
  const manifest = {
    ...repo.manifest,
    schema_version: PROTOCOL_VERSION,
    protocol_version: PROTOCOL_VERSION,
    upgraded_at: timestamp,
    upgraded_from: repo.manifest.protocol_version,
  };
  const project = {
    ...repo.projectState,
    schema_version: PROTOCOL_VERSION,
    updated_at: timestamp,
  };
  const backupRoot = path.join(repo.paths.backups, 'upgrade', compactTimestamp());
  ensureDirectory(backupRoot);
  const manifestBackup = path.join(backupRoot, 'manifest.json');
  const projectBackup = path.join(backupRoot, 'project.json');
  fs.copyFileSync(repo.paths.manifest, manifestBackup, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(repo.paths.projectState, projectBackup, fs.constants.COPYFILE_EXCL);
  ensureDirectory(repo.paths.events);
  try {
    writeJsonAtomic(repo.paths.manifest, manifest);
    writeJsonAtomic(repo.paths.projectState, project);
  } catch (error) {
    fs.copyFileSync(manifestBackup, repo.paths.manifest);
    fs.copyFileSync(projectBackup, repo.paths.projectState);
    throw error;
  }
  return {
    mode: 'APPLY',
    project_id: manifest.project_id,
    from: plan.from,
    to: PROTOCOL_VERSION,
    preserves_sealed_history: true,
    written: plan.writes,
    previous_state_revision: plan.state_revision,
    git_head: repo.git.commit,
    backup: relativeUnix(repo.repoRoot, backupRoot),
  };
}
