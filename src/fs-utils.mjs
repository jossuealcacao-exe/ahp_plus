import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AhpError } from './errors.mjs';

export function now() {
  return new Date().toISOString();
}

export function compactTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(/[-:.]/g, '').replace('Z', 'Z');
}

export function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new AhpError(`Cannot read JSON ${file}: ${error.message}`, {
      code: 'INVALID_JSON',
      details: { file },
    });
  }
}

export function writeTextAtomic(file, content) {
  ensureDirectory(path.dirname(file));
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

export function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJsonExclusive(file, value) {
  ensureDirectory(path.dirname(file));
  try {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new AhpError(`Refusing to overwrite existing file ${file}`, {
        code: 'COLLISION',
      });
    }
    throw error;
  }
}

export function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walkFiles(target) : [target];
    });
}

export function walkJson(directory) {
  return walkFiles(directory).filter((file) => file.endsWith('.json'));
}

export function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function relativeUnix(parent, child) {
  return path.relative(parent, child).split(path.sep).join('/');
}

export function makeId(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${date}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export function safeSegment(value, fallback = 'default') {
  const safe = String(value || fallback)
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return safe || fallback;
}
