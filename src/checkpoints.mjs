import path from 'node:path';
import { csv, pipeList } from './args.mjs';
import { ID_PREFIXES } from './constants.mjs';
import { invariant } from './errors.mjs';
import { makeId, now, readJson, safeSegment, walkJson, writeJsonExclusive } from './fs-utils.mjs';
import { seal } from './integrity.mjs';
import { preflightWrite } from './preflight.mjs';
import { actorFrom } from './records.mjs';
import { documentVersion, projectId, repository } from './state.mjs';

export function createCheckpoint(input, options = {}) {
  invariant(options.summary, '--summary is required', { code: 'INVALID_ARGUMENT' });
  const owner = options.actor || 'AI agent';
  const { repo } = preflightWrite(input, { ...options, actor: owner }, `session:${options.session || owner}`);
  const sessionId = safeSegment(options.session || `${options.platform || 'generic'}-${owner}`);
  const id = makeId(ID_PREFIXES.checkpoint);
  const checkpoint = seal({
    schema_version: documentVersion(repo),
    id,
    kind: 'checkpoint',
    session_id: sessionId,
    project_id: projectId(repo),
    summary: String(options.summary),
    objective: String(options.objective || repo.projectState.objective),
    next_action: String(options['next-action'] || repo.projectState.next_action),
    files: csv(options.files),
    validations: csv(options.validations),
    blockers: pipeList(options.blockers),
    actor: actorFrom(options),
    git: {
      branch: repo.git.branch,
      commit: repo.git.commit,
      tree: repo.git.tree,
      working_tree: repo.git.working_tree,
      changed_files: repo.git.changed_files,
      working_tree_digest: repo.git.working_tree_digest,
      project_working_tree: repo.git.project_working_tree,
      project_changed_files: repo.git.project_changed_files,
      project_working_tree_digest: repo.git.project_working_tree_digest,
      ahp_state_working_tree: repo.git.ahp_state_working_tree,
      ahp_state_changed_files: repo.git.ahp_state_changed_files,
      upstream: repo.git.upstream,
      ahead: repo.git.ahead,
      behind: repo.git.behind,
    },
    created_at: now(),
  });
  const file = path.join(repo.paths.sessions, sessionId, `${id}.json`);
  writeJsonExclusive(file, checkpoint);
  return { ...checkpoint, file: path.relative(repo.repoRoot, file).split(path.sep).join('/') };
}

export function checkpoints(repoOrInput = '.', options = {}) {
  const repo = typeof repoOrInput === 'string' ? repository(repoOrInput) : repoOrInput;
  let values = walkJson(repo.paths.sessions).map((file) => ({ file, checkpoint: readJson(file) }));
  if (options.session) values = values.filter(({ checkpoint }) => checkpoint.session_id === options.session);
  return values.sort((left, right) => right.checkpoint.created_at.localeCompare(left.checkpoint.created_at));
}

export function latestCheckpoint(repoOrInput = '.', options = {}) {
  return checkpoints(repoOrInput, options)[0] || null;
}
