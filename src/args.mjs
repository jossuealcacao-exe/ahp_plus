import { AhpError } from './errors.mjs';

const SHORT = Object.freeze({ h: 'help', v: 'version' });

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  let passthrough = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (passthrough) {
      positionals.push(value);
      continue;
    }
    if (value === '--') {
      passthrough = true;
      continue;
    }
    if (/^-[a-zA-Z]$/.test(value)) {
      const key = SHORT[value.slice(1)];
      if (!key) throw new AhpError(`Unknown short option ${value}`, { code: 'INVALID_ARGUMENT' });
      options[key] = true;
      continue;
    }
    if (value.startsWith('--')) {
      const equals = value.indexOf('=');
      if (equals > 2) {
        options[value.slice(2, equals)] = value.slice(equals + 1);
        continue;
      }
      const key = value.slice(2);
      if (key.startsWith('no-')) {
        options[key.slice(3)] = false;
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        options[key] = next;
        index += 1;
      } else {
        options[key] = true;
      }
      continue;
    }
    positionals.push(value);
  }

  return { options, positionals };
}

export function assertKnownOptions(options, allowed, command) {
  const accepted = new Set(['help', 'version', 'root', ...allowed]);
  const unknown = Object.keys(options).filter((key) => !accepted.has(key));
  if (!unknown.length) return;
  const rendered = unknown.map((key) => `--${key}`).join(', ');
  throw new AhpError(
    `Unknown option${unknown.length === 1 ? '' : 's'} for ${command}: ${rendered}`,
    {
      code: 'INVALID_ARGUMENT',
      details: { command, unknown_options: unknown, allowed_options: [...accepted].sort() },
    },
  );
}

export function csv(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

export function pipeList(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value).split('|').map((item) => item.trim()).filter(Boolean);
}
