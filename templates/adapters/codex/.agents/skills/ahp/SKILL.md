---
name: ahp
description: Verify, query, checkpoint, govern, and hand off project work using the repository-installed AHP+ CLI and .ahp state. Use when Codex starts or resumes work in an AHP+ project, receives semantic /ahp or /agent commands, must preserve context before a platform change, or needs evidence-backed continuity tied to Git.
---

# AHP+

Resolve the current repository with `ahp root`; never infer the project from a
parent workspace. Run `ahp doctor` and `ahp verify --strict` before substantive
work.

For context, use `ahp context --format markdown --budget 8000`. Inspect Git and
the reported portability status before relying on a handoff.

During material work, create checkpoints with an explicit summary and next
action. Before changing platforms, run `ahp handoff create --to <platform>`.
When receiving work, run `ahp handoff receive <id>` and resolve every failed
preflight check before editing.

Use `--expected-head` and `--expected-state` for contested writes. Treat locks
as cooperative notices, not distributed synchronization.

Never claim a command or external action occurred without tool evidence. AHP+
does not authorize commit, push, pull, merge, deploy, publish, destructive
operations, or access to secrets.
