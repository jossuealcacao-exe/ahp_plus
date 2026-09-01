import fs from 'node:fs';
import path from 'node:path';
import {
  CERTAINTY_LEVELS,
  CLI_VERSION,
  PROTOCOL_VERSION,
  STATE_DIRECTORY,
} from './constants.mjs';
import { digestObject } from './canonical-json.mjs';
import { invariant } from './errors.mjs';
import {
  ensureDirectory,
  now,
  readJson,
  relativeUnix,
  safeSegment,
  walkJson,
  writeJsonExclusive,
  writeTextAtomic,
} from './fs-utils.mjs';
import { gitState } from './git.mjs';
import { seal } from './integrity.mjs';
import { resolveRepository } from './root.mjs';

const DIRECTORIES = [
  'state', 'sessions', 'records/decisions', 'records/tasks', 'records/bugs',
  'records/risks', 'records/qa', 'records/requirements', 'evidence', 'handoffs',
    'locks', 'events', 'archive/legacy-records', 'archive/legacy-metadata', 'archive/locks',
  'backups', 'cache', 'tmp',
];

function filesIn(directory) {
  return walkJson(directory).map((file) => path.basename(file));
}

export function migrationPlan(input = '.') {
  const resolved = resolveRepository(input);
  invariant(resolved.layout === 'legacy', 'Migration requires a legacy /agent layout and no existing .ahp state.', { code: 'MIGRATION_NOT_APPLICABLE', exitCode: 2 });
  const legacy = resolved.stateRoot;
  const destination = path.join(resolved.repoRoot, STATE_DIRECTORY);
  return {
    mode: 'PLAN',
    source: relativeUnix(resolved.repoRoot, legacy),
    destination: relativeUnix(resolved.repoRoot, destination),
    source_preserved: true,
    destination_exists: fs.existsSync(destination),
    counts: {
      records: filesIn(path.join(legacy, 'records')).length,
      evidence: filesIn(path.join(legacy, 'evidence')).length,
      handoffs: filesIn(path.join(legacy, 'handoffs')).length,
      locks: filesIn(path.join(legacy, 'locks')).length,
    },
    steps: [
      'Create a new .ahp layout.',
      'Normalize supported typed records and evidence.',
      'Convert legacy handoffs to the 1.1 integrity contract.',
      'Archive unsupported legacy metadata inside .ahp/archive.',
      'Leave the original /agent directory untouched.',
      'Run ahp verify --strict after review.',
    ],
  };
}

function normalizeActor(value) {
  return {
    name: String(value?.name || 'Legacy actor'),
    platform: String(value?.platform || 'unknown'),
    model: String(value?.model || 'unknown'),
  };
}

function normalizeRecord(record, projectId) {
  const normalized = {
    ...record,
    schema_version: PROTOCOL_VERSION,
    project_id: record.project_id || projectId,
    actor: normalizeActor(record.actor),
    source_refs: Array.isArray(record.source_refs) ? record.source_refs : [],
    base_commit: record.base_commit ?? null,
  };
  return normalized;
}

function normalizeHandoff(handoff, projectId) {
  const git = {
    branch: handoff.branch ?? null,
    commit: handoff.base_commit ?? null,
    tree: null,
    working_tree: handoff.working_tree || 'UNKNOWN',
    changed_files: [],
    working_tree_digest: null,
    project_working_tree: handoff.working_tree || 'UNKNOWN',
    project_changed_files: [],
    project_working_tree_digest: null,
    ahp_state_working_tree: 'UNKNOWN',
    ahp_state_changed_files: [],
    upstream: null,
    ahead: null,
    behind: null,
    remote: null,
    ...(handoff.git || {}),
  };
  return seal({
    schema_version: PROTOCOL_VERSION,
    id: handoff.id,
    kind: 'handoff',
    from: handoff.from || 'legacy-agent',
    to: handoff.to || 'next-agent',
    project_id: handoff.project_id || projectId,
    objective: handoff.objective || 'Continue legacy AHP+ work',
    git,
    portability: {
      status: git.working_tree === 'CLEAN' && git.commit ? 'PUSH_REQUIRED' : 'LOCAL_ONLY',
      reason: 'Migrated handoff; remote synchronization was not proven during migration.',
    },
    checkpoint_id: null,
    completed: handoff.completed || [],
    in_progress: handoff.in_progress || [],
    pending: handoff.pending || [],
    decisions: handoff.decisions || [],
    validations: handoff.validations || [],
    risks: handoff.risks || [],
    requirements: handoff.requirements || [],
    relevant_files: handoff.relevant_files || [],
    blockers: handoff.blockers || [],
    assumptions: handoff.assumptions || ['Legacy handoff fields may be incomplete.'],
    next_action: handoff.next_action || 'Revalidate the repository and create a new AHP+ 1.1 checkpoint.',
    done_criteria: handoff.done_criteria || [],
    notes: handoff.notes || '',
    created_at: handoff.created_at || now(),
    receiver_preflight: handoff.receiver_preflight || [
      'Run ahp verify --strict.',
      'Compare the current Git commit with the migrated handoff.',
      'Create a fresh AHP+ 1.1 checkpoint before writing.',
    ],
  });
}

function copyJson(source, destination) {
  ensureDirectory(path.dirname(destination));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

export function applyMigration(input = '.', options = {}) {
  const plan = migrationPlan(input);
  invariant(options.apply, 'Migration is plan-only by default. Pass --apply after reviewing the plan.', { code: 'APPLY_REQUIRED', exitCode: 2 });
  invariant(!plan.destination_exists, '.ahp already exists; refusing to merge state automatically.', { code: 'COLLISION', exitCode: 2 });
  const resolved = resolveRepository(input);
  const legacy = resolved.stateRoot;
  const destination = path.join(resolved.repoRoot, STATE_DIRECTORY);
  for (const directory of DIRECTORIES) ensureDirectory(path.join(destination, directory));

  const legacyManifest = readJson(path.join(legacy, 'MANIFEST.json'));
  const legacyState = readJson(path.join(legacy, 'CURRENT_STATE.json'));
  const projectId = safeSegment(legacyState.project_id || 'default');
  const timestamp = now();
  const manifest = {
    schema_version: PROTOCOL_VERSION,
    protocol: 'AHP+',
    protocol_version: PROTOCOL_VERSION,
    cli_version_created: CLI_VERSION,
    instance_id: legacyManifest.instance_id || cryptoRandomId(),
    project_id: projectId,
    owner: legacyManifest.owner || 'Unknown owner',
    root: STATE_DIRECTORY,
    created_at: legacyManifest.created_at || timestamp,
    migrated_at: timestamp,
    migrated_from: {
      layout: 'agent',
      protocol_version: legacyManifest.version || '1.0.0',
    },
    certainty_levels: CERTAINTY_LEVELS,
    governance: {
      source_of_truth: 'git',
      state_scope: 'one-instance-per-git-repository',
      network_mutations: 'never',
      external_actions_require_authority: true,
    },
  };
  const git = gitState(resolved.repoRoot);
  const project = {
    schema_version: PROTOCOL_VERSION,
    project_id: projectId,
    phase: legacyState.phase || 'DISCOVERY',
    objective: legacyState.objective || 'Revalidate migrated project context',
    next_action: legacyState.next_action || 'Run ahp verify --strict and create a checkpoint',
    confidence: legacyState.confidence || 'UNVERIFIED',
    blockers: Array.isArray(legacyState.blockers) ? legacyState.blockers : [],
    base_commit: git.commit,
    created_at: legacyState.created_at || timestamp,
    updated_at: timestamp,
  };
  writeJsonExclusive(path.join(destination, 'manifest.json'), manifest);
  writeJsonExclusive(path.join(destination, 'state/project.json'), project);
  writeTextAtomic(path.join(destination, 'README.md'), '# AHP+ state\n\nMigrated from the legacy `/agent` layout. The source directory was preserved.\n');
  writeTextAtomic(path.join(destination, 'INDEX.md'), '# AHP+ Project Brief\n\nRun `ahp brief` after migration verification.\n');

  const migrated = { records: 0, evidence: 0, handoffs: 0, locks: 0, archived: 0 };
  for (const file of walkJson(path.join(legacy, 'records'))) {
    const record = readJson(file);
    if (['decision', 'task', 'bug', 'risk', 'qa', 'requirement'].includes(record.kind)) {
      const plural = record.kind === 'qa' ? 'qa' : `${record.kind}s`;
      writeJsonExclusive(path.join(destination, 'records', plural, `${record.id}.json`), normalizeRecord(record, projectId));
      migrated.records += 1;
    } else {
      copyJson(file, path.join(destination, 'archive/legacy-records', path.basename(file)));
      migrated.archived += 1;
    }
  }
  for (const file of walkJson(path.join(legacy, 'evidence'))) {
    const record = normalizeRecord(readJson(file), projectId);
    writeJsonExclusive(path.join(destination, 'evidence', `${record.id}.json`), record);
    migrated.evidence += 1;
  }
  for (const file of walkJson(path.join(legacy, 'handoffs'))) {
    const handoff = normalizeHandoff(readJson(file), projectId);
    writeJsonExclusive(path.join(destination, 'handoffs', `${handoff.id}.json`), handoff);
    migrated.handoffs += 1;
  }
  for (const file of walkJson(path.join(legacy, 'locks'))) {
    const lock = { ...readJson(file), schema_version: PROTOCOL_VERSION };
    const targetDirectory = Date.parse(lock.expires_at) > Date.now() ? 'locks' : 'archive/locks';
    writeJsonExclusive(path.join(destination, targetDirectory, `${lock.id}.json`), lock);
    migrated.locks += 1;
  }
  for (const name of ['PROJECTS.json', 'BACKLOG.json']) {
    const source = path.join(legacy, name);
    if (fs.existsSync(source)) copyJson(source, path.join(destination, 'archive/legacy-metadata', name));
  }

  const report = {
    schema_version: PROTOCOL_VERSION,
    mode: 'APPLY',
    source: 'agent',
    destination: '.ahp',
    source_preserved: true,
    created_at: timestamp,
    base_commit: git.commit,
    migrated,
  };
  report.digest = digestObject({ ...report, digest: null });
  writeJsonExclusive(path.join(destination, 'migration.json'), report);
  return report;
}

function cryptoRandomId() {
  return `migrated-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
