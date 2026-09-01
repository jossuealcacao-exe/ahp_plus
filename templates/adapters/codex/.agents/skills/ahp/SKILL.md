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

Use the resolved invocation to run `project root`; never infer the project from
a parent workspace. Then run `project check` before substantive work. On Git
detection failures, rerun `project doctor --diagnose-git` and preserve its
structured output.

For context, use `session context --format markdown --budget 8000`. Inspect Git,
`local_readiness`, and transport portability before relying on a handoff.

During material work, create `session checkpoint` records with an explicit summary and next
action. Before changing platforms, run `ahp handoff create --to <platform>`.
When receiving work, run `ahp handoff receive <id>` and resolve every failed
preflight check before editing.

Record only material operational boundaries as Continuity Events. Use
`message send`, `message inbox`, `message reply`, and `message verify` for
selected cross-platform messages; use low-level `event append` for other event
types. Do not
capture greetings, hidden reasoning, secrets, or the full chat by default.
Verify the event fingerprint and causal parent before relying on an imported
event. A local event does not prove realtime delivery or actor authentication.

For authenticated delivery, use the intent-first `relay send`, `relay wait` or
`relay receive`, `relay confirm`, and `relay receipt verify` commands. Require
an explicitly configured channel and environment secret. Return the observed
EVT, RLY, and RCP IDs and fingerprints. The reference shared-secret HMAC does
not prove a unique device, account, human, or model identity, and the file
channel is not encrypted.
Do not assume chat commands inherit integrated-terminal variables. Prefer host
secret injection or `--secret-file` pointing to a permission-restricted file
outside Git; never place a real credential in chat.

When the user asks Codex to consult Claude, prefer the installed MCP tool
`ahp_consult`; otherwise run `ahp agent ask claude "<question>" --from codex`.
Request exactly one read-only response, show the actual request/response event
IDs and fingerprints, and do not start an autonomous back-and-forth. For secure
device delivery, use `identity`, `secure`, and `secure network` commands and
require a verified `SRC` receipt before claiming delivery.

Use `--expected-head` and `--expected-state` for contested writes. Treat locks
as cooperative notices, not distributed synchronization.

Never claim a command or external action occurred without tool evidence. AHP+
does not authorize commit, push, pull, merge, deploy, publish, destructive
operations, or access to secrets.

Map explicit `$ahp` requests such as `project check`, `session context`,
`session checkpoint`, `message send`, `message inbox`, `message reply`,
`message verify`, `agent ask`, `identity list`, `secure network send`,
`relay send`, `relay wait`, `relay confirm`,
`relay receipt verify`, `handoff to <platform>`, and `receive <HOF-ID>` to the
corresponding installed CLI operations. Return the actual EVT ID and fingerprint
for message writes and the actual RLY/RCP IDs for relay operations. Do not
describe local capture or channel availability as receiver-confirmed delivery.
