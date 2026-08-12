import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invariant } from './errors.mjs';
import { compactTimestamp, ensureDirectory, relativeUnix, writeTextAtomic } from './fs-utils.mjs';
import { preflightWrite } from './preflight.mjs';

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, 'templates/adapters');
const BEGIN = '<!-- AHP+:BEGIN -->';
const END = '<!-- AHP+:END -->';

const PLATFORM_FILES = Object.freeze({
  generic: [
    { source: 'generic/AHP_INSTRUCTIONS.md', target: 'AHP_INSTRUCTIONS.md', mode: 'copy' },
    { source: 'generic/AGENTS.fragment.md', target: 'AGENTS.md', mode: 'managed-append' },
  ],
  claude: [
    { source: 'claude/CLAUDE.fragment.md', target: 'CLAUDE.md', mode: 'managed-append' },
  ],
  cursor: [
    { source: 'cursor/ahp.md', target: '.cursor/commands/ahp.md', mode: 'copy' },
  ],
  opencode: [
    { source: 'opencode/ahp.md', target: '.opencode/commands/ahp.md', mode: 'copy' },
  ],
  codex: [
    { source: 'codex/.agents/skills/ahp/SKILL.md', target: '.agents/skills/ahp/SKILL.md', mode: 'copy' },
    { source: 'codex/.agents/skills/ahp/agents/openai.yaml', target: '.agents/skills/ahp/agents/openai.yaml', mode: 'copy' },
  ],
  chatgpt: [
    { source: 'chatgpt/AHP_MOBILE.md', target: 'AHP_MOBILE.md', mode: 'copy' },
  ],
});

export function adapterNames() {
  return Object.keys(PLATFORM_FILES);
}

function selectedPlatforms(name) {
  if (name === 'all') return adapterNames();
  invariant(PLATFORM_FILES[name], `Unknown adapter ${name}. Expected one of: ${[...adapterNames(), 'all'].join(', ')}`, { code: 'INVALID_ADAPTER' });
  return name === 'generic' ? ['generic'] : ['generic', name];
}

function managedContent(fragment) {
  return `${BEGIN}\n${fragment.trim()}\n${END}`;
}

function planFile(repo, entry, platform, options) {
  const source = path.join(TEMPLATE_ROOT, entry.source);
  invariant(fs.existsSync(source), `Adapter template missing: ${entry.source}`, { code: 'PACKAGE_CORRUPT' });
  const target = path.join(repo.repoRoot, entry.target);
  const template = fs.readFileSync(source, 'utf8');
  if (!fs.existsSync(target)) return { platform, ...entry, action: 'CREATE', source, target, content: entry.mode === 'managed-append' ? `${managedContent(template)}\n` : template };
  const existing = fs.readFileSync(target, 'utf8');
  if (entry.mode === 'managed-append') {
    if (existing.includes(BEGIN) && existing.includes(END)) return { platform, ...entry, action: 'UNCHANGED', source, target };
    return { platform, ...entry, action: 'APPEND', source, target, content: `${existing.trimEnd()}\n\n${managedContent(template)}\n` };
  }
  if (existing === template) return { platform, ...entry, action: 'UNCHANGED', source, target };
  return { platform, ...entry, action: options.replace ? 'REPLACE' : 'COLLISION', source, target, content: template };
}

export function adapterPlan(input, name, options = {}) {
  const { repo } = preflightWrite(input, options, `adapter:${name}`);
  const seen = new Set();
  const entries = [];
  for (const platform of selectedPlatforms(name)) {
    for (const entry of PLATFORM_FILES[platform]) {
      if (seen.has(entry.target)) continue;
      seen.add(entry.target);
      entries.push(planFile(repo, entry, platform, options));
    }
  }
  return {
    mode: options.apply ? 'APPLY' : 'PLAN',
    adapter: name,
    root: repo.repoRoot,
    entries: entries.map((entry) => ({
      platform: entry.platform,
      target: relativeUnix(repo.repoRoot, entry.target),
      action: entry.action,
    })),
    collisions: entries.filter((entry) => entry.action === 'COLLISION').map((entry) => relativeUnix(repo.repoRoot, entry.target)),
    _internal: { repo, entries },
  };
}

export function installAdapter(input, name, options = {}) {
  const plan = adapterPlan(input, name, options);
  if (!options.apply) return withoutInternal(plan);
  invariant(plan.collisions.length === 0, `Adapter collisions require review or --replace: ${plan.collisions.join(', ')}`, { code: 'COLLISION', exitCode: 2 });
  const backupRoot = path.join(plan._internal.repo.paths.backups, 'adapters', compactTimestamp());
  const applied = [];
  for (const entry of plan._internal.entries) {
    if (entry.action === 'UNCHANGED') continue;
    if (fs.existsSync(entry.target)) {
      const backup = path.join(backupRoot, relativeUnix(plan._internal.repo.repoRoot, entry.target));
      ensureDirectory(path.dirname(backup));
      fs.copyFileSync(entry.target, backup, fs.constants.COPYFILE_EXCL);
    }
    writeTextAtomic(entry.target, entry.content);
    applied.push(relativeUnix(plan._internal.repo.repoRoot, entry.target));
  }
  return { ...withoutInternal(plan), applied, backup: applied.length && fs.existsSync(backupRoot) ? relativeUnix(plan._internal.repo.repoRoot, backupRoot) : null };
}

function withoutInternal(plan) {
  const { _internal, ...publicPlan } = plan;
  return publicPlan;
}
