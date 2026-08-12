# Changelog

## Unreleased

- Fetch complete Git history in CI so strict AHP+ ancestry verification has
  sufficient evidence.
- Report a missing base commit in shallow clones as unavailable history rather
  than stale project state.

## 1.1.0-emancipation.0 — 2026-08-12

- Extract AHP+ into an independent protocol and zero-dependency Node.js CLI.
- Scope each installation to one Git repository.
- Introduce `.ahp/` state with read-only legacy `/agent` migration.
- Resolve commands correctly from repository subdirectories.
- Add per-session checkpoints and handoff create, inspect, and receive flows.
- Classify continuity as local-only, push-required, diverged, or remote-ready.
- Add canonical integrity, expected state revisions, schemas, adapters, and conformance tests.
- License the public protocol and CLI under Apache-2.0.
