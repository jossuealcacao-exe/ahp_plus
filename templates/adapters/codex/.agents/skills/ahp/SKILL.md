---
name: ahp
description: Verify, query, checkpoint, govern, and hand off project work using the repository-installed AHP+ CLI and .ahp state. Use when Codex starts or resumes work in an AHP+ project, receives semantic /ahp or /agent commands, must preserve context before a platform change, or needs evidence-backed continuity tied to Git.
---

# AHP+

Resolve the repository-installed CLI before any protocol command. Prefer
`npx --no-install ahp`; if that is unavailable, try the local shim at
`node_modules/.bin/ahp` or `node_modules/.bin/ahp.cmd`. Use a global `ahp` only
after its version matches the local package. Never let a resolver download a
different version implicitly.

Use the resolved invocation to run `root`; never infer the project from a
parent workspace. Then run `doctor` and `verify --strict` before substantive
work. On Git detection failures, rerun `doctor --diagnose-git` and preserve its
structured output.

For context, use `context --format markdown --budget 8000`. Inspect Git,
`local_readiness`, and transport portability before relying on a handoff.

During material work, create checkpoints with an explicit summary and next
action. Before changing platforms, run `ahp handoff create --to <platform>`.
When receiving work, run `ahp handoff receive <id>` and resolve every failed
preflight check before editing.

Record only material operational boundaries as Continuity Events. Use
`event append` for directives, decisions, observed actions, blockers,
validations, capability changes, and selected cross-platform messages. Do not
capture greetings, hidden reasoning, secrets, or the full chat by default.
Verify the event fingerprint and causal parent before relying on an imported
event. A local event does not prove realtime delivery or actor authentication.

Use `--expected-head` and `--expected-state` for contested writes. Treat locks
as cooperative notices, not distributed synchronization.

Never claim a command or external action occurred without tool evidence. AHP+
does not authorize commit, push, pull, merge, deploy, publish, destructive
operations, or access to secrets.

Map explicit `$ahp` requests such as `doctor`, `verify strict`, `context`,
`status`, `checkpoint`, `handoff to <platform>`, and `receive <HOF-ID>` to the
corresponding installed CLI operations.
