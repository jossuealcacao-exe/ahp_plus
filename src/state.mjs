import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CERTAINTY_LEVELS,
  CLI_VERSION,
  PHASES,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  STATE_DIRECTORY,
} from './constants.mjs';
import { digestObject, sha256 } from './canonical-json.mjs';
import { AhpError, invariant } from './errors.mjs';
import {
  ensureDirectory,
  now,
  readJson,
  relativeUnix,
  safeSegment,
  walkJson,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs-utils.mjs';
import { gitState } from './git.mjs';
import { resolveRepository, statePaths } from './root.mjs';

const LAYOUT_DIRECTORIES = [
  'state',
  'sessions',
  'records/decisions',
  'records/tasks',
  'records/bugs',
  'records/risks',
  'records/qa',
  'records/requirements',
  'evidence',
  'handoffs',
  'events',
  'relay/outbox',
  'relay/inbox',
  'relay/receipts',
  'identities/devices',
  'secure/outbox',
  'secure/inbox',
  'secure/receipts',
  'locks',
  'archive/locks',
  'backups',
  'cache',
  'tmp',
];

const GITIGNORE_BEGIN = '# AHP+:BEGIN';
const GITIGNORE_END = '# AHP+:END';
const GITIGNORE_BLOCK = `${GITIGNORE_BEGIN}\n!.ahp/\n!.ahp/**\n.ahp/cache/\n.ahp/tmp/\n${GITIGNORE_END}`;

function ensureGitIgnore(repoRoot) {
  const file = path.join(repoRoot, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(GITIGNORE_BEGIN) && existing.includes(GITIGNORE_END)) return;
  const content = existing.trimEnd() ? `${existing.trimEnd()}\n\n${GITIGNORE_BLOCK}\n` : `${GITIGNORE_BLOCK}\n`;
  writeTextAtomic(file, content);
}

export function assertProjectId(value) {
  invariant(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value),
    `Invalid project ID ${JSON.stringify(value)}. Use lowercase letters, digits, dot, underscore, or hyphen.`,
    { code: 'INVALID_PROJECT_ID' });
}

export function initializeRepository(input, options = {}) {
  const resolved = resolveRepository(input, { requireState: false });
  invariant(resolved.layout === 'missing',
    resolved.layout === 'legacy'
      ? `Legacy AHP+ state exists at ${resolved.stateRoot}. Run \`ahp migrate --plan\`.`
      : `AHP+ is already initialized at ${resolved.stateRoot}.`,
    { code: 'ALREADY_INITIALIZED', exitCode: 2 });

  const owner = typeof options.owner === 'string' ? options.owner.trim() : '';
  invariant(owner, '--owner is required for initialization', { code: 'INVALID_ARGUMENT' });
  const projectId = safeSegment(options.project || path.basename(resolved.repoRoot));
  assertProjectId(projectId);

  const stateRoot = path.join(resolved.repoRoot, STATE_DIRECTORY);
  for (const directory of LAYOUT_DIRECTORIES) ensureDirectory(path.join(stateRoot, directory));
  ensureGitIgnore(resolved.repoRoot);
  const git = gitState(resolved.repoRoot);
  const timestamp = now();
  const manifest = {
    schema_version: PROTOCOL_VERSION,
    protocol: 'AHP+',
    protocol_version: PROTOCOL_VERSION,
    cli_version_created: CLI_VERSION,
    instance_id: crypto.randomUUID(),
    project_id: projectId,
    owner,
    root: STATE_DIRECTORY,
    created_at: timestamp,
    certainty_levels: CERTAINTY_LEVELS,
    governance: {
      source_of_truth: 'git',
      state_scope: 'one-instance-per-git-repository',
      network_mutations: 'never',
      external_actions_require_authority: true,
    },
  };
  const projectState = {
    schema_version: PROTOCOL_VERSION,
    project_id: projectId,
    phase: options.phase || 'DISCOVERY',
    objective: options.objective || 'Establish verified project context',
    next_action: options['next-action'] || 'Run ahp doctor, then create the first checkpoint',
    confidence: options.confidence || 'UNVERIFIED',
    blockers: [],
    base_commit: git.commit,
    created_at: timestamp,
    updated_at: timestamp,
  };
  invariant(PHASES.includes(projectState.phase), `Invalid phase ${projectState.phase}. Allowed phases: ${PHASES.join(', ')}`, {
    code: 'INVALID_PHASE', details: { value: projectState.phase, allowed: PHASES },
  });
  invariant(CERTAINTY_LEVELS.includes(projectState.confidence), `Invalid confidence ${projectState.confidence}. Allowed values: ${CERTAINTY_LEVELS.join(', ')}`, {
    code: 'INVALID_CONFIDENCE', details: { value: projectState.confidence, allowed: CERTAINTY_LEVELS },
  });

  writeJsonAtomic(path.join(stateRoot, 'manifest.json'), manifest);
  writeJsonAtomic(path.join(stateRoot, 'state/project.json'), projectState);
  writeTextAtomic(path.join(stateRoot, 'README.md'), '# AHP+ state\n\nCanonical, Git-backed project continuity. Do not store secrets.\n');
  writeTextAtomic(path.join(stateRoot, 'INDEX.md'), '# AHP+ Project Brief\n\nRun `ahp brief` to regenerate this view.\n');

  return repository(input);
}

export function repository(input = '.') {
  const resolved = resolveRepository(input);
  const paths = statePaths(resolved);
  const manifest = readJson(paths.manifest);
  const projectState = readJson(paths.projectState);
  const git = gitState(resolved.repoRoot);
  return { ...resolved, paths, manifest, projectState, git };
}

export function projectId(repositoryValue, requested = null) {
  const canonical = repositoryValue.manifest.project_id || repositoryValue.projectState.project_id;
  if (requested && requested !== canonical) {
    throw new AhpError(
      `Project ${requested} does not match this repository's AHP+ project ${canonical}.`,
      { code: 'PROJECT_SCOPE_MISMATCH', exitCode: 2 },
    );
  }
  return canonical;
}

export function documentVersion(repositoryValue) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(repositoryValue.manifest?.protocol_version)
    ? repositoryValue.manifest.protocol_version
    : PROTOCOL_VERSION;
}

export function stateRevision(repositoryValue) {
  const hash = crypto.createHash('sha256');
  const files = walkJson(repositoryValue.stateRoot)
    .filter((file) => !file.includes(`${path.sep}backups${path.sep}`))
    .filter((file) => !file.includes(`${path.sep}cache${path.sep}`))
    .sort();
  for (const file of files) {
    hash.update(relativeUnix(repositoryValue.stateRoot, file));
    hash.update(sha256(fs.readFileSync(file)));
  }
  return hash.digest('hex');
}

export function updateProjectState(repositoryValue, options = {}) {
  const current = structuredClone(repositoryValue.projectState);
  current.schema_version = documentVersion(repositoryValue);
  if (options.phase !== undefined) {
    invariant(PHASES.includes(options.phase), `Invalid phase ${options.phase}. Allowed phases: ${PHASES.join(', ')}. Use --objective for a work-unit identifier.`, {
      code: 'INVALID_PHASE', details: { value: options.phase, allowed: PHASES, work_unit_field: 'objective' },
    });
    current.phase = options.phase;
  }
  if (options.confidence !== undefined) {
    invariant(CERTAINTY_LEVELS.includes(options.confidence), `Invalid confidence ${options.confidence}. Allowed values: ${CERTAINTY_LEVELS.join(', ')}`, {
      code: 'INVALID_CONFIDENCE', details: { value: options.confidence, allowed: CERTAINTY_LEVELS },
    });
    current.confidence = options.confidence;
  }
  if (options.objective !== undefined) current.objective = String(options.objective);
  if (options['next-action'] !== undefined) current.next_action = String(options['next-action']);
  if (options.blockers !== undefined) {
    current.blockers = String(options.blockers).split('|').map((item) => item.trim()).filter(Boolean);
  }
  current.base_commit = repositoryValue.git.commit;
  current.updated_at = now();
  writeJsonAtomic(repositoryValue.paths.projectState, current);
  return current;
}

export function snapshotIdentity(repositoryValue) {
  return {
    project_id: projectId(repositoryValue),
    git: {
      branch: repositoryValue.git.branch,
      commit: repositoryValue.git.commit,
      tree: repositoryValue.git.tree,
      working_tree: repositoryValue.git.working_tree,
      working_tree_digest: repositoryValue.git.working_tree_digest,
    },
    state_revision: stateRevision(repositoryValue),
  };
}

export function contentDigest(value) {
  return digestObject(value);
}
