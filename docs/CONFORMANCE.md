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
14. Routes categorized 1.4 commands without breaking their 1.2 aliases.
15. Sends, filters, replies to, and verifies directed messages while preserving
    causal parent fingerprints.
16. Preserves the original event fingerprint across an authenticated relay.
17. Produces a separately fingerprinted receiver receipt bound to the envelope,
    event, route, project, and receiver destination.
18. Rejects wrong secrets, changed payloads, conflicting replay, wrong scope,
    expiry, and missing causal parents before import.
19. Keeps push, receive, reconnect, and receipt synchronization idempotent.
20. Runs one-command setup idempotently and preserves existing adapter content.
21. Keeps device private keys outside Git and verifies public identity seals.
22. Encrypts SEC payloads, verifies device signatures, and binds SRC receipts to
    the exact envelope and event fingerprints.
23. Requires HTTPS outside loopback and rejects unsafe token files.
24. Limits live cross-agent consultation to one read-only response with causal
    request/response fingerprints.

Reference checks:

```bash
npm test
npm run conformance
npm run validate
```

`verify --strict` treats warnings as non-conformance for the inspected project.
