#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(process.execPath, ['--test', 'tests/conformance.test.mjs'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
