import path from 'node:path';
import { pipeList } from './args.mjs';
import { ID_PREFIXES, PROTOCOL_VERSION, TERMINAL_STATUSES } from './constants.mjs';
import { latestCheckpoint } from './checkpoints.mjs';
import { portability } from './context.mjs';
import { invariant } from './errors.mjs';
import { makeId, now, readJson, walkJson, writeJsonExclusive } from './fs-utils.mjs';
import { gitCommitRelation } from './git.mjs';
import { seal, verifySeal } from './integrity.mjs';
import { preflightWrite } from './preflight.mjs';
import { allRecords } from './records.mjs';
import { projectId, repository } from './state.mjs';

function handoffFile(repo, id) {
  return path.join(repo.paths.handoffs, `${id}.json`);
}

export function createHandoff(input, options = {}) {
  invariant(options.to, '--to is required', { code: 'INVALID_ARGUMENT' });
  const { repo } = preflightWrite(input, options, 'handoff');
  const records = allRecords(repo).map(({ record }) => record);
  const checkpoint = latestCheckpoint(repo, { session: options.session })?.checkpoint || null;
  const relevantFiles = new Set([
    ...(checkpoint?.files || []),
    ...repo.git.changed_files.map((entry) => entry.path),
  ]);
  const observedPortability = portability(repo.git);
  const handoffPortability = observedPortability.status === 'REMOTE_READY'
    ? { status: 'PUSH_REQUIRED', reason: 'The new handoff manifest must be committed and pushed before another clone can receive it.' }
    : observedPortability;
  const id = makeId(ID_PREFIXES.handoff);
  const value = seal({
    schema_version: PROTOCOL_VERSION,
    id,
    kind: 'handoff',
    from: String(options.from || options.platform || 'current-agent'),
    to: String(options.to),
    project_id: projectId(repo, options.project),
    objective: String(checkpoint?.objective || repo.projectState.objective),
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
      remote: repo.git.remote,
    },
    portability: handoffPortability,
    checkpoint_id: checkpoint?.id || null,
    completed: records.filter((record) => record.kind === 'task' && record.status === 'COMPLETED').map((record) => record.id),
    in_progress: records.filter((record) => record.kind === 'task' && record.status === 'IN_PROGRESS').map((record) => record.id),
    pending: records.filter((record) => record.kind === 'task' && !TERMINAL_STATUSES.has(record.status) && record.status !== 'IN_PROGRESS').map((record) => record.id),
    decisions: records.filter((record) => record.kind === 'decision' && record.status === 'ACCEPTED').map((record) => record.id),
    validations: records.filter((record) => record.kind === 'qa' && record.status === 'PASS').map((record) => record.id),
    risks: records.filter((record) => record.kind === 'risk' && !TERMINAL_STATUSES.has(record.status)).map((record) => record.id),
    requirements: records.filter((record) => record.kind === 'requirement' && !TERMINAL_STATUSES.has(record.status)).map((record) => record.id),
    relevant_files: [...relevantFiles].sort(),
    blockers: checkpoint?.blockers?.length ? checkpoint.blockers : repo.projectState.blockers,
    assumptions: pipeList(options.assumptions),
    next_action: String(options['next-action'] || checkpoint?.next_action || repo.projectState.next_action),
    done_criteria: pipeList(options['done-criteria']),
    notes: String(options.summary || checkpoint?.summary || ''),
    created_at: now(),
    receiver_preflight: [
      'Resolve the receiving Git repository root.',
      'Run ahp verify --strict.',
      'Compare project_id, branch, commit, tree, and working-tree digest.',
      'Inspect active locks and portability status.',
      'Do not pull, switch, merge, or overwrite without user authority.',
    ],
  });
  const file = handoffFile(repo, id);
  writeJsonExclusive(file, value);
  return { ...value, file: path.relative(repo.repoRoot, file).split(path.sep).join('/') };
}

export function findHandoff(repoOrInput, id) {
  const repo = typeof repoOrInput === 'string' ? repository(repoOrInput) : repoOrInput;
  const direct = handoffFile(repo, id);
  if (readable(direct)) return { repo, file: direct, handoff: readJson(direct) };
  for (const file of walkJson(repo.paths.handoffs)) {
    const handoff = readJson(file);
    if (handoff.id === id) return { repo, file, handoff };
  }
  return null;
}

function readable(file) {
  try {
    return Boolean(readJson(file));
  } catch {
    return false;
  }
}

export function inspectHandoff(input, id) {
  const hit = findHandoff(input, id);
  invariant(hit, `Handoff not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  return {
    id,
    file: path.relative(hit.repo.repoRoot, hit.file).split(path.sep).join('/'),
    integrity_valid: verifySeal(hit.handoff),
    handoff: hit.handoff,
  };
}

function check(name, status, expected, actual, guidance) {
  return { name, status, expected, actual, guidance };
}

export function receiveHandoff(input, id) {
  const hit = findHandoff(input, id);
  invariant(hit, `Handoff not found: ${id}`, { code: 'NOT_FOUND', exitCode: 2 });
  const { repo, handoff } = hit;
  const checks = [];
  const integrityValid = verifySeal(handoff);
  checks.push(check('integrity', integrityValid ? 'PASS' : 'FAIL', true, integrityValid, 'Do not continue from a tampered handoff.'));
  const sameProject = handoff.project_id === projectId(repo);
  checks.push(check('project_id', sameProject ? 'PASS' : 'FAIL', handoff.project_id, projectId(repo), 'Open the repository named by the handoff.'));
  const relation = gitCommitRelation(repo.repoRoot, handoff.git.commit, repo.git.commit);
  const commitCompatible = ['EXACT', 'AHP_ENVELOPE_DESCENDANT'].includes(relation.relation);
  checks.push(check('commit', commitCompatible ? 'PASS' : 'FAIL', handoff.git.commit, repo.git.commit, 'Fetch and reconcile only with explicit user authority.'));
  const sameTree = handoff.git.tree === repo.git.tree;
  checks.push(check('tree', sameTree || relation.relation === 'AHP_ENVELOPE_DESCENDANT' ? 'PASS' : 'FAIL', handoff.git.tree, repo.git.tree, 'Verify that only the AHP+ envelope changed after the handoff base.'));
  const sameBranch = handoff.git.branch === repo.git.branch;
  checks.push(check('branch', sameBranch ? 'PASS' : 'WARN', handoff.git.branch, repo.git.branch, 'Confirm whether detached or alternate-branch continuation is intended.'));
  if (handoff.git.project_working_tree === 'DIRTY') {
    const sameWorkingTree = handoff.git.project_working_tree_digest === repo.git.project_working_tree_digest;
    checks.push(check('project_working_tree_digest', sameWorkingTree ? 'PASS' : 'FAIL', handoff.git.project_working_tree_digest, repo.git.project_working_tree_digest, 'Uncommitted project changes are local-only and must match exactly.'));
  } else {
    checks.push(check('project_working_tree', repo.git.project_working_tree === 'CLEAN' ? 'PASS' : 'WARN', 'CLEAN', repo.git.project_working_tree, 'Inspect receiving-side project changes before continuing.'));
  }
  const failures = checks.filter((item) => item.status === 'FAIL');
  return {
    ok: failures.length === 0,
    outcome: failures.length ? 'RECONCILIATION_REQUIRED' : 'READY',
    handoff_id: id,
    portability: handoff.portability,
    checks,
    next_action: failures.length ? failures[0].guidance : handoff.next_action,
    receiver_preflight: handoff.receiver_preflight,
  };
}
