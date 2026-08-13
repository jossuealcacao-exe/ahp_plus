#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from '../src/constants.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errors = [];
const warnings = [];
const placeholderPrefix = `[${'TO' + 'DO'}:`;
const required = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'SPECIFICATION.md',
  'LICENSE',
  'VERSION',
  'package.json',
  'bin/ahp.mjs',
  'src/cli.mjs',
  'schemas/manifest.schema.json',
  'schemas/project-state.schema.json',
  'schemas/record.schema.json',
  'schemas/checkpoint.schema.json',
  'schemas/handoff.schema.json',
  'schemas/lock.schema.json',
  'docs/CONFORMANCE.md',
  'docs/GETTING_STARTED_ES.md',
  'docs/OPERATIONS_ES.md',
  'docs/WHY_AHP_ES.md',
  'docs/COMMANDS_BY_SURFACE_ES.md',
  'docs/CHANNELS_ES.md',
  'docs/COMMUNITY_FEEDBACK_ES.md',
  'templates/adapters/codex/.agents/skills/ahp/SKILL.md',
];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`missing ${relative}`);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

for (const file of walk(root)) {
  if (file.endsWith('.json')) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { errors.push(`invalid JSON ${path.relative(root, file)}: ${error.message}`); }
  }
  if (/\.(?:mjs|md|json|yaml)$/.test(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(placeholderPrefix)) errors.push(`unresolved placeholder in ${path.relative(root, file)}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const versionFile = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
if (packageJson.version !== CLI_VERSION) errors.push(`package version ${packageJson.version} differs from CLI ${CLI_VERSION}`);
if (versionFile !== CLI_VERSION) errors.push(`VERSION ${versionFile} differs from CLI ${CLI_VERSION}`);
if (packageJson.scripts?.test !== 'node --test') errors.push('test script must use shell-independent Node.js test discovery');
for (const entry of [
  'bin', 'src', 'schemas', 'templates', 'docs', 'SPECIFICATION.md', 'README.md',
  'CHANGELOG.md', 'SECURITY.md', 'VERSION', 'LICENSE', 'NOTICE',
]) {
  if (!packageJson.files?.includes(entry)) errors.push(`package files omit ${entry}`);
}
if (packageJson.private !== false) errors.push('public package must not be marked private');
if (packageJson.license !== 'Apache-2.0') errors.push('public package must declare Apache-2.0');
if (packageJson.publishConfig?.access !== 'public') errors.push('scoped npm package must publish with public access');
if (packageJson.publishConfig?.registry !== 'https://registry.npmjs.org/') errors.push('npm publish registry must be the official public registry');

if (process.platform !== 'win32') {
  const executable = fs.statSync(path.join(root, 'bin/ahp.mjs')).mode & 0o111;
  if (!executable) errors.push('bin/ahp.mjs is not executable');
}

try {
  execFileSync(process.execPath, [path.join(root, 'bin/ahp.mjs'), 'verify', root, '--strict'], { cwd: root, stdio: 'pipe' });
} catch (error) {
  errors.push(`self verification failed: ${error.stdout?.toString() || error.stderr?.toString() || error.message}`);
}

const result = {
  ok: errors.length === 0,
  version: CLI_VERSION,
  root,
  files: walk(root).length,
  errors,
  warnings,
  release_gate: {
    package_private: packageJson.private,
    license: packageJson.license,
    public_release_ready: errors.length === 0,
  },
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 2;
