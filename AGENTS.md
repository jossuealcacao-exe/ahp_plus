# AHP+ Universal Agent Entry

This repository contains the normative AHP+ specification and its reference
CLI. Durable claims must be derived from repository files, Git, reproducible
commands, or explicit user confirmation.

Before substantive work:

1. Run `node bin/ahp.mjs doctor` and `node bin/ahp.mjs verify --strict`.
2. Confirm `git rev-parse --show-toplevel`, branch, commit, and working tree.
3. Read `.ahp/manifest.json`, `.ahp/state/project.json`, and `.ahp/INDEX.md` when present.
4. Preserve protocol semantics across platform adapters.
5. Never perform commit, push, pull, merge, publish, deploy, or destructive operations without explicit authority.

AHP+ records state and verifies portability. It does not grant authority for
external actions and never treats model output as execution evidence.
