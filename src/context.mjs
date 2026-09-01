import fs from 'node:fs';
import path from 'node:path';
import { TERMINAL_STATUSES } from './constants.mjs';
import { checkpoints, latestCheckpoint } from './checkpoints.mjs';
import { readJson, walkJson, writeTextAtomic } from './fs-utils.mjs';
import { allRecords } from './records.mjs';
import { activeLocks } from './preflight.mjs';
import { projectId, repository, stateRevision } from './state.mjs';
import { verifyRepository } from './validation.mjs';
import { diagnoseGit } from './git.mjs';

export function portability(git) {
  if (!git.is_git || !git.commit) return { status: 'LOCAL_ONLY', reason: 'Repository has no committed HEAD.' };
  if (git.project_working_tree !== 'CLEAN') return { status: 'LOCAL_ONLY', reason: 'Project working-tree changes are not transported by Git.' };
  if (git.behind !== null && git.behind > 0) return { status: 'REMOTE_DIVERGED', reason: `Branch is behind upstream by ${git.behind} commit(s).` };
  if (!git.upstream) return { status: 'PUSH_REQUIRED', reason: 'No upstream branch is configured.' };
  if (git.ahead !== null && git.ahead > 0) return { status: 'PUSH_REQUIRED', reason: `Branch is ahead of upstream by ${git.ahead} commit(s).` };
  if (git.ahp_state_working_tree !== 'CLEAN') return { status: 'PUSH_REQUIRED', reason: 'AHP+ state has uncommitted changes.' };
  if (git.ahead === 0 && git.behind === 0) return { status: 'REMOTE_READY', reason: 'Committed state matches the configured upstream.' };
  return { status: 'PUSH_REQUIRED', reason: 'Remote synchronization could not be proven.' };
}

export function readiness(input = '.', options = {}) {
  const repo = repository(input);
  const verification = verifyRepository(input, { strict: true });
  const transport = portability(repo.git);
  const locks = activeLocks(repo).map(({ lock }) => lock);
  const platform = options.platform ? String(options.platform) : null;
  const candidateHandoffs = handoffs(repo).filter((handoff) => !platform || handoff.to === platform);
  const blockers = [];
  if (!verification.ok) blockers.push(...verification.errors, ...verification.warnings);
  if (repo.projectState.confidence === 'CONFLICTED') blockers.push('Project state confidence is CONFLICTED.');
  return {
    protocol: 'AHP+',
    protocol_version: repo.manifest.protocol_version,
    project_id: projectId(repo),
    local_readiness: {
      status: blockers.length ? 'BLOCKED' : 'READY',
      blockers,
      working_tree: repo.git.project_working_tree,
      working_tree_digest: repo.git.project_working_tree_digest,
    },
    transport_readiness: {
      status: transport.status === 'REMOTE_READY' ? 'READY' : 'BLOCKED',
      portability: transport,
    },
    platform,
    candidate_handoffs: candidateHandoffs.map((handoff) => ({
      id: handoff.id,
      from: handoff.from,
      to: handoff.to,
      created_at: handoff.created_at,
      next_action: handoff.next_action,
      fingerprint: handoff.integrity?.digest || null,
    })),
    active_locks: locks,
    limitations: ['Candidate handoffs are filtered by destination; receipt state is not persisted by AHP+ Core.'],
    git: repo.git,
    verification,
  };
}

function handoffs(repo) {
  return walkJson(repo.paths.handoffs)
    .map((file) => readJson(file))
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function continuityEvents(repo) {
  return walkJson(repo.paths.events)
    .map((file) => readJson(file))
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function effectiveCheckpoint(repo, checkpoint) {
  if (!checkpoint) return null;
  const checkpointTime = Date.parse(checkpoint.created_at || '');
  const stateTime = Date.parse(repo.projectState.updated_at || '');
  return Number.isFinite(checkpointTime) && checkpointTime > stateTime ? checkpoint : null;
}

export function status(input = '.') {
  const repo = repository(input);
  const verification = verifyRepository(input, { strict: false });
  const latest = latestCheckpoint(repo)?.checkpoint || null;
  const effective = effectiveCheckpoint(repo, latest);
  const records = allRecords(repo).map(({ record }) => record);
  const counts = {};
  for (const record of records) counts[record.kind] = (counts[record.kind] || 0) + 1;
  return {
    protocol: 'AHP+',
    protocol_version: repo.manifest.protocol_version,
    cli_layout: repo.layout,
    project_id: projectId(repo),
    phase: repo.projectState.phase,
    objective: effective?.objective || repo.projectState.objective,
    next_action: effective?.next_action || repo.projectState.next_action,
    confidence: repo.projectState.confidence,
    git: repo.git,
    portability: portability(repo.git),
    readiness: {
      local: verification.ok && repo.projectState.confidence !== 'CONFLICTED' ? 'READY' : 'BLOCKED',
      transport: portability(repo.git).status === 'REMOTE_READY' ? 'READY' : 'BLOCKED',
    },
    state_revision: stateRevision(repo),
    records: counts,
    continuity_events: continuityEvents(repo).length,
    latest_checkpoint: latest,
    effective_checkpoint: effective,
    active_locks: activeLocks(repo).map(({ lock }) => lock),
    warnings: verification.warnings,
  };
}

export function projectContext(input = '.', options = {}) {
  const repo = repository(input);
  const records = allRecords(repo).map(({ record }) => record);
  const activeRecords = records.filter((record) => !TERMINAL_STATUSES.has(record.status));
  const latest = latestCheckpoint(repo, { session: options.session })?.checkpoint || null;
  const checkpoint = effectiveCheckpoint(repo, latest);
  return {
    protocol: 'AHP+',
    protocol_version: repo.manifest.protocol_version,
    project_id: projectId(repo, options.project),
    manifest: repo.manifest,
    state: repo.projectState,
    effective: {
      objective: checkpoint?.objective || repo.projectState.objective,
      next_action: checkpoint?.next_action || repo.projectState.next_action,
      blockers: checkpoint?.blockers?.length ? checkpoint.blockers : repo.projectState.blockers,
    },
    git: repo.git,
    portability: portability(repo.git),
    state_revision: stateRevision(repo),
    latest_checkpoint: latest,
    effective_checkpoint: checkpoint,
    active_records: activeRecords.slice(0, Number(options.limit || 100)),
    recent_handoffs: handoffs(repo).slice(0, Number(options['handoff-limit'] || 5)),
    recent_continuity_events: continuityEvents(repo).slice(0, Number(options['event-limit'] || 10)),
    active_locks: activeLocks(repo).map(({ lock }) => lock),
    warnings: verifyRepository(input, { strict: false }).warnings,
  };
}

function lineForRecord(record) {
  return `- [${record.kind}/${record.status}/${record.confidence}] ${record.id}: ${record.title}`;
}

export function contextMarkdown(context, options = {}) {
  const budget = Math.max(256, Number(options.budget || 8000));
  const maxCharacters = budget * 4;
  const lines = [
    '# AHP+ Project Context',
    '',
    `- Project: ${context.project_id}`,
    `- Phase: ${context.state.phase}`,
    `- Objective: ${context.effective.objective}`,
    `- Confidence: ${context.state.confidence}`,
    `- Git branch: ${context.git.branch || 'n/a'}`,
    `- Git commit: ${context.git.commit || 'n/a'}`,
    `- Working tree: ${context.git.working_tree}`,
    `- Portability: ${context.portability.status} — ${context.portability.reason}`,
    `- State revision: ${context.state_revision}`,
    `- Next action: ${context.effective.next_action}`,
    '',
    '## Blockers',
    '',
    ...(context.effective.blockers.length ? context.effective.blockers.map((value) => `- ${value}`) : ['- None.']),
    '',
    '## Latest checkpoint',
    '',
    context.latest_checkpoint
      ? `- ${context.latest_checkpoint.id}: ${context.latest_checkpoint.summary}`
      : '- None.',
    '',
    '## Active records',
    '',
  ];
  if (!context.active_records.length) lines.push('- None.');
  for (const record of context.active_records) {
    const next = lineForRecord(record);
    if ([...lines, next, '', '_Context truncated to requested budget._'].join('\n').length > maxCharacters) {
      lines.push('_Context truncated to requested budget._');
      break;
    }
    lines.push(next);
  }
  if (context.warnings.length) {
    lines.push('', '## Warnings', '', ...context.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join('\n')}\n`;
}

export function writeBrief(input = '.', options = {}) {
  const repo = repository(input);
  const context = projectContext(input, options);
  const markdown = contextMarkdown(context, options);
  writeTextAtomic(repo.paths.index, markdown);
  return { file: path.relative(repo.repoRoot, repo.paths.index).split(path.sep).join('/'), markdown };
}

export function doctor(input = '.', options = {}) {
  const repo = repository(input);
  const verification = verifyRepository(input, { strict: false });
  const checks = [
    { name: 'git_repository', status: repo.git.is_git ? 'PASS' : 'FAIL', detail: repo.git.root },
    { name: 'repository_scope', status: repo.git.root === repo.repoRoot ? 'PASS' : 'FAIL', detail: repo.repoRoot },
    { name: 'state_layout', status: repo.layout === 'modern' ? 'PASS' : 'WARN', detail: repo.layout },
    { name: 'state_validation', status: verification.ok ? 'PASS' : 'FAIL', detail: `${verification.errors.length} error(s), ${verification.warnings.length} warning(s)` },
    { name: 'project_identity', status: repo.manifest.project_id === repo.projectState.project_id ? 'PASS' : 'FAIL', detail: repo.manifest.project_id },
  ];
  const result = {
    ok: checks.every((check) => check.status !== 'FAIL'),
    protocol: 'AHP+',
    root: repo.repoRoot,
    state_root: repo.stateRoot,
    checks,
    portability: portability(repo.git),
    verification,
  };
  const staleBoundary = verification.warnings.some((warning) => warning.includes('base_commit is stale'));
  if (staleBoundary) {
    result.recommendations = [{
      code: 'ACCEPT_REVIEWED_HEAD',
      reason: 'The current HEAD contains project changes newer than the accepted state boundary.',
      command: `ahp set-state . --accept-head --expected-head ${repo.git.commit} --expected-state ${stateRevision(repo)}`,
      authority_required: true,
    }];
  }
  if (options['diagnose-git'] || options.verbose || !repo.git.is_git) result.git_diagnostic = diagnoseGit(repo.repoRoot);
  return result;
}

export function history(input = '.', options = {}) {
  const repo = repository(input);
  return {
    project_id: projectId(repo, options.project),
    checkpoints: checkpoints(repo, options).map(({ checkpoint }) => checkpoint),
    handoffs: handoffs(repo),
  };
}
