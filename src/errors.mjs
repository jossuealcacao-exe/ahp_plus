export class AhpError extends Error {
  constructor(message, { code = 'AHP_ERROR', exitCode = 1, details = null } = {}) {
    super(message);
    this.name = 'AhpError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function invariant(condition, message, options) {
  if (!condition) throw new AhpError(message, options);
}
