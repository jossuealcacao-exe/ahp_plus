import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adapterNames, installAdapter } from './adapters.mjs';
import { csv } from './args.mjs';
import { doctor } from './context.mjs';
import { invariant } from './errors.mjs';
import { runGit } from './git.mjs';
import { resolveRepository } from './root.mjs';
import { initializeRepository, repository } from './state.mjs';
import { verifyRepository } from './validation.mjs';
import { createDeviceIdentity, listDeviceIdentities } from './identity.mjs';
import { applyUpgrade } from './upgrade.mjs';
import { PROTOCOL_VERSION } from './constants.mjs';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PACKAGE = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

function requestedPlatforms(value) {
  const selected = csv(value || 'codex,claude');
  const known = new Set([...adapterNames(), 'all']);
  for (const platform of selected) {
    invariant(known.has(platform), `Unknown setup platform ${platform}. Expected one of: ${[...known].join(', ')}`, {
      code: 'INVALID_ADAPTER',
    });
  }
  return selected.includes('all') ? ['all'] : selected;
}

function inferredOwner(repoRoot, options) {
  const explicit = typeof options.owner === 'string' ? options.owner.trim() : '';
  if (explicit) return explicit;
  return runGit(repoRoot, ['config', 'user.name'], null)
    || process.env.USER
    || process.env.USERNAME
    || 'Project owner';
}

function ensureLocalPackage(repoRoot, options) {
  if (options.install === false) return { status: 'SKIPPED', reason: '--no-install' };
  const executable = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'ahp.cmd' : 'ahp');
  const installedManifest = path.join(repoRoot, 'node_modules', ...PACKAGE.name.split('/'), 'package.json');
  let installedVersion = null;
  try { installedVersion = JSON.parse(fs.readFileSync(installedManifest, 'utf8')).version || null; } catch { /* install below */ }
  if (fs.existsSync(executable) && installedVersion === PACKAGE.version) {
    return { status: 'PRESENT', package: PACKAGE.name, version: PACKAGE.version };
  }
  const spec = `${PACKAGE.name}@${PACKAGE.version}`;
  try {
    execFileSync('npm', ['install', '--save-dev', '--save-exact', spec], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    invariant(false, `Cannot install ${spec} in this project: ${error.stderr || error.message}`, {
      code: 'PACKAGE_INSTALL_FAILED', exitCode: 2,
    });
  }
  return {
    status: installedVersion ? 'UPDATED' : 'INSTALLED',
    package: PACKAGE.name,
    version: PACKAGE.version,
    previous_version: installedVersion,
  };
}

export function setupProject(input = '.', options = {}) {
  const resolved = resolveRepository(input, { requireState: false });
  invariant(resolved.layout !== 'legacy', 'Legacy AHP+ state requires `ahp migrate --plan` before setup.', {
    code: 'MIGRATION_REQUIRED', exitCode: 2,
  });

  const packageInstall = ensureLocalPackage(resolved.repoRoot, options);

  const initialized = resolved.layout === 'missing';
  if (initialized) {
    initializeRepository(resolved.repoRoot, {
      owner: inferredOwner(resolved.repoRoot, options),
      project: options.project || path.basename(resolved.repoRoot),
      phase: options.phase,
      objective: options.objective,
      'next-action': options['next-action'],
      confidence: options.confidence,
    });
  }

  const current = repository(resolved.repoRoot);
  const upgrade = current.manifest.protocol_version === PROTOCOL_VERSION
    ? { mode: 'UNCHANGED', from: PROTOCOL_VERSION, to: PROTOCOL_VERSION }
    : applyUpgrade(resolved.repoRoot, { ...options, apply: true });

  const installed = [];
  for (const platform of requestedPlatforms(options.platforms)) {
    installed.push(installAdapter(resolved.repoRoot, platform, {
      apply: true,
      replace: Boolean(options.replace),
    }));
  }

  const identityPlatforms = requestedPlatforms(options.platforms).includes('all')
    ? ['codex', 'claude']
    : requestedPlatforms(options.platforms).filter((platform) => ['codex', 'claude'].includes(platform));
  const existingIdentities = listDeviceIdentities(resolved.repoRoot).identities;
  const identities = [];
  if (options.identity !== false) {
    for (const platform of identityPlatforms) {
      const existing = existingIdentities.find((identity) => identity.platform === platform && identity.status === 'ACTIVE');
      if (existing) {
        identities.push({ platform, device_id: existing.device_id, status: 'PRESENT' });
      } else {
        const created = createDeviceIdentity(resolved.repoRoot, {
          name: `${platform} on ${os.hostname()}`,
          platform,
          store: options.store,
        });
        identities.push({ platform, device_id: created.device_id, status: 'CREATED', private_file: created.private_file });
      }
    }
  }

  const repo = repository(resolved.repoRoot);
  const diagnostic = doctor(resolved.repoRoot);
  const verification = verifyRepository(resolved.repoRoot, { strict: true });
  const applied = installed.flatMap((item) => item.applied || []);
  const appliedTargets = new Set(applied);
  const unchanged = installed.flatMap((item) => item.entries || [])
    .filter((item) => item.action === 'UNCHANGED')
    .map((item) => item.target)
    .filter((item) => !appliedTargets.has(item));

  return {
    ok: diagnostic.ok && verification.ok,
    status: diagnostic.ok && verification.ok ? 'AHP_READY' : 'AHP_NEEDS_ATTENTION',
    root: repo.repoRoot,
    project_id: repo.manifest.project_id,
    initialized,
    owner: repo.manifest.owner,
    package: packageInstall,
    upgrade,
    platforms: requestedPlatforms(options.platforms),
    identities,
    applied: [...new Set(applied)],
    unchanged: [...new Set(unchanged)],
    checks: {
      doctor: diagnostic.ok ? 'PASS' : 'FAIL',
      strict_verification: verification.ok ? 'PASS' : 'FAIL',
    },
    next: 'Open the project in Codex or Claude and ask: "Use AHP+ to check this project, then consult the other agent read-only."',
  };
}
