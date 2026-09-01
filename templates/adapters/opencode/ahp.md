---
description: Inspect or update AHP+ Git-backed project continuity
---

Read `AHP_INSTRUCTIONS.md`. Interpret `$ARGUMENTS` using the installed `ahp`
CLI. Resolve the repository root, run verification before writes, and preserve
the protocol's authority gates. Report observed results only.

Prefer the categorized forms: `/ahp project check`, `/ahp session context`,
`/ahp session checkpoint ...`, `/ahp message send to=<platform> text="..."`,
`/ahp message inbox for=<platform>`, `/ahp message reply <EVT-ID> text="..."`,
`/ahp relay send <EVT-ID> channel=<path>`, `/ahp relay wait as=<platform>
channel=<path>`, `/ahp relay confirm as=<platform> channel=<path>`,
`/ahp handoff to <platform>`, and `/ahp receive <HOF-ID>`.

Return actual EVT IDs and fingerprints produced by message commands. A local
event is not evidence of realtime delivery or receipt.
Relay operations must return observed RLY/RCP IDs and fingerprints. Shared-key
authentication is not unique device or model identity.
