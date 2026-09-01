# Changelog

## Unreleased

- Start AHP+ 1.2 field hardening from the first external Claude-to-Codex field
  report: local-first CLI resolution, observable Git diagnostics, actionable
  enum errors, explicit HEAD acceptance, and separate local/transport readiness.
- Add append-only Continuity Event Capsules with SHA-256 fingerprints, causal
  parent links, local verification, privacy/authority fields, and an explicit
  boundary for future authenticated A2A/MCP relay providers.
- Retain read compatibility with sealed AHP+ 1.1.0 documents and reject unknown
  command options instead of silently ignoring typos.
- Require the complete release gate through npm `prepublishOnly` and document
  the `1.2.0-dev.0` → `next` → consumer/Windows validation → `1.2.0` promotion
  path without automatically updating existing installations.
- Add professional English and Spanish GitHub landing pages, a repository hero
  image, bilingual contribution templates, and clearer product positioning.
- Link the public repository to the maintainer portfolio and expand discovery
  topics for AI governance, developer tooling, Node.js, and npm.

## 1.1.0 — 2026-08-12

- Promote the independently versioned AHP+ protocol and reference CLI to its
  first stable public release.
- Validate a real public-consumer handoff from Codex to Cursor in
  `iris-foundation` with receiver outcome `READY`.
- Add public Spanish guides for installation, daily operations, product
  positioning, commands by host surface, and community feedback.
- Define `latest` as the stable npm channel and `next` as the prerelease
  development channel.
- Distribute the stable release through npm and GitHub with a downloadable
  package artifact and checksum.

## 1.1.0-emancipation.1 — 2026-08-12

- Fetch complete Git history in CI so strict AHP+ ancestry verification has
  sufficient evidence.
- Report a missing base commit in shallow clones as unavailable history rather
  than stale project state.
- Use shell-independent Node.js test discovery for Windows compatibility.
- Normalize repository roots from Git into native absolute paths, including
  Windows long-path identity.
- Upgrade the official checkout and setup-node actions to their current major
  versions.

## 1.1.0-emancipation.0 — 2026-08-12

- Extract AHP+ into an independent protocol and zero-dependency Node.js CLI.
- Scope each installation to one Git repository.
- Introduce `.ahp/` state with read-only legacy `/agent` migration.
- Resolve commands correctly from repository subdirectories.
- Add per-session checkpoints and handoff create, inspect, and receive flows.
- Classify continuity as local-only, push-required, diverged, or remote-ready.
- Add canonical integrity, expected state revisions, schemas, adapters, and conformance tests.
- License the public protocol and CLI under Apache-2.0.
