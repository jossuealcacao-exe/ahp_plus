# Conformance

An AHP+ Core implementation is conformant only when it passes the normative
fixtures and demonstrates the following behaviors:

1. Resolves the correct Git repository from root and nested directories.
2. Refuses to borrow parent state from a nested Git repository.
3. Validates all typed documents and integrity envelopes.
4. Rejects stale expected HEAD or state revisions.
5. Keeps concurrent session checkpoints separate.
6. Never marks a dirty repository remotely ready.
7. Detects handoff tampering and receiver mismatches.
8. Preserves legacy state during migration.
9. Installs adapters without silent overwrites.
10. Performs no Git network, commit, merge, branch-switch, or publication action.
11. Separates local continuation readiness from remote transport readiness.
12. Validates continuity-event integrity, causal parent fingerprints, and
    append-only history.
13. Reads sealed 1.1.0 documents without rewriting their provenance.

Reference checks:

```bash
npm test
npm run conformance
npm run validate
```

`verify --strict` treats warnings as non-conformance for the inspected project.
