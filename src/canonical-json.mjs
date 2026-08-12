import crypto from 'node:crypto';

function normalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, normalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function digestObject(value) {
  return sha256(canonicalJson(value));
}

export function integrityEnvelope(value) {
  return {
    algorithm: 'sha256',
    canonicalization: 'ahp-canonical-json-v1',
    digest: digestObject(value),
  };
}
