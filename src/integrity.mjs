import { digestObject } from './canonical-json.mjs';

export function seal(object) {
  const value = {
    ...object,
    integrity: {
      algorithm: 'sha256',
      canonicalization: 'ahp-canonical-json-v1',
      digest: null,
    },
  };
  value.integrity.digest = digestObject(value);
  return value;
}

export function verifySeal(object) {
  if (!object?.integrity) return false;
  const expected = digestObject({
    ...object,
    integrity: { ...object.integrity, digest: null },
  });
  return object.integrity.algorithm === 'sha256'
    && object.integrity.canonicalization === 'ahp-canonical-json-v1'
    && object.integrity.digest === expected;
}
