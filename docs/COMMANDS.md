# AHP+ command contract

AHP+ 1.4 uses an object-action grammar:

```text
ahp <category> <action> [target] [options]
```

This groups commands by the protocol object they affect. Run `ahp help`,
`ahp help <category>`, or `ahp catalog --format json` for discovery. AHP+ 1.2
forms remain compatible aliases so existing scripts do not need an immediate
rewrite.

## Setup

| Command | Meaning |
|---|---|
| `ahp setup [path]` | Install/configure Codex and Claude adapters, initialize or upgrade protocol state, create device identities, and run doctor plus strict verification. If the repository has no `package.json`, create a minimal private one before installing AHP+ locally. |

Use `--platforms`, `--no-install`, or `--no-identity` only when customizing the
guided default. For a single IDE, use `--platforms codex` or `--platforms
claude`. Repeating setup is idempotent.

## Live agent consultation

| Command | Meaning |
|---|---|
| `ahp live status` | Report Codex/Claude CLI availability and the read-only one-hop policy. |
| `ahp live serve` | Expose `ahp_project_check` and `ahp_consult` over MCP stdio. |
| `ahp agent ask claude "QUESTION"` | Request one bounded read-only Claude response from Codex. |
| `ahp agent ask codex "QUESTION"` | Request one bounded read-only Codex response from Claude. |

Each consultation persists a causally linked request and response. It is not a
continuous autonomous conversation and does not grant mutation authority.
Claude consultations default to a USD 1 maximum budget; operators may set a
lower positive value with `--max-budget-usd`.

## Shared project conversation

| Command | Meaning |
|---|---|
| `ahp conversation open "TITLE" --participants codex,claude --from codex` | Open a durable, shared project conversation room. |
| `ahp conversation list [--for PLATFORM]` | List rooms available to a participant. |
| `ahp conversation send conv-ID "TEXT" --from PLATFORM` | Append a causal message to the room. |
| `ahp conversation inbox conv-ID --for PLATFORM` | Read messages addressed to that participant. |
| `ahp conversation wait conv-ID --for PLATFORM --timeout 60` | Explicitly wait for a new room message for up to five minutes. |

Rooms are surfaced through MCP tools in each participant's own chat. They do
not inject content into another IDE's native chat, wake an idle agent, or prove
remote delivery. Relay or secure-network delivery remains a separate, verified
operation.

## Project

| Command | Meaning |
|---|---|
| `ahp project init` | Initialize `.ahp/` in the current Git repository. |
| `ahp project check` | Run the recommended doctor, strict verification, and local/transport readiness pulse. |
| `ahp project status` | Report effective state, Git, locks, and portability. |
| `ahp project verify --strict` | Validate structure, semantics, references, secrets, and integrity. |
| `ahp project doctor` | Check Git identity, repository scope, layout, and validation. |
| `ahp project ready` | Separate local continuation readiness from transport readiness. |
| `ahp project state` | Update stable project state after concurrency preflight. |
| `ahp project root` | Report the resolved Git and AHP+ roots. |
| `ahp project upgrade --plan/--apply` | Upgrade active metadata while preserving sealed history and backups. |

Legacy aliases: `init`, `status`, `verify`, `doctor`, `ready`, `set-state`,
`root`, and `upgrade`.

## Session

| Command | Meaning |
|---|---|
| `ahp session context` | Return bounded machine-readable or Markdown context. |
| `ahp session brief` | Regenerate `.ahp/INDEX.md`. |
| `ahp session checkpoint` | Persist a recoverable per-session boundary. |
| `ahp session history` | List checkpoints and handoffs. |

Legacy aliases: `context`, `brief`, `checkpoint`, and `history`.

## Messages

Messages are selected operational Continuity Events, not a copy of the whole
conversation.

| Command | Meaning |
|---|---|
| `ahp message send "TEXT" --to PLATFORM` | Create and fingerprint a directed `MESSAGE`. |
| `ahp message reply EVT-ID "TEXT"` | Verify the parent, infer its session/destination, and append a causal reply. |
| `ahp message inbox --for PLATFORM` | List directed messages for a platform. |
| `ahp message outbox --from PLATFORM` | List messages emitted by a platform. |
| `ahp message list` | Filter messages by session, origin, destination, or limit. |
| `ahp message verify EVT-ID` | Verify content integrity and the causal parent fingerprint. |

Examples:

```bash
ahp message send "Continue from the verified boundary" \
  --from cursor --to codex --session project-chat

ahp message inbox --for codex --session project-chat
ahp message reply EVT-... "Received and verified" --from codex
ahp message verify EVT-...
```

The low-level `event append/list/verify` commands remain available for advanced
event types. A local message does not prove realtime delivery, authenticated
identity, or receipt. An authorized relay and independent receiver evidence are
required for remote transport states; in the reference profile that evidence is
a receiver-created receipt authenticated by the shared project credential.

## Relay

The intent-first relay path uses a protected shared directory as the reference
channel and reads a minimum 32-byte secret from `AHP_RELAY_SECRET` by default:

| Command | Meaning |
|---|---|
| `ahp relay send EVT-ID --channel DIR` | Prepare an authenticated envelope and make it available to the destination. |
| `ahp relay receive --as PLATFORM --channel DIR` | Import valid messages for the receiver and create receipts. |
| `ahp relay wait --as PLATFORM --channel DIR` | Poll the durable spool until a message arrives or timeout expires. |
| `ahp relay confirm --as PLATFORM --channel DIR` | Import receipts returning to the original sender identity. |
| `ahp relay receipt verify RCP-ID` | Verify receipt integrity, HMAC, route, envelope, and message linkage. |

Advanced primitives are `prepare`, `push`, `pull`, `watch`, `receipts`, and
`verify`. Use `--secret-env NAME` to select a different environment variable or
`--secret-file FILE` to read a host-provisioned, non-symlink credential file.
On POSIX the file must deny group/other access (`chmod 600`).
`AHP_RELAY_SECRET_FILE` is the environment-based file-path fallback. AHP+ never
persists the secret. Repeated delivery is idempotent. The message, envelope,
and receipt have separate fingerprints.

The reference file channel is persistent and reconnectable but is not an
encrypted Internet relay. HMAC assurance is scoped to a shared project secret,
not a unique device or model identity. A production network provider must add
transport confidentiality and access control.

## Device identity and secure relay

| Command | Meaning |
|---|---|
| `ahp identity create --name NAME --platform PLATFORM` | Create Ed25519/X25519 keys; persist only the public identity in Git state. |
| `ahp identity list` | List active project device identities. |
| `ahp identity verify DEV-ID` | Verify the sealed public identity. |
| `ahp secure send EVT-ID --from-device DEV-A --to-device DEV-B --channel DIR` | Encrypt, sign, and publish through the file carrier. |
| `ahp secure receive --as-device DEV-B --channel DIR` | Verify, decrypt, import, and sign a receipt. |
| `ahp secure confirm --as-device DEV-A --channel DIR` | Import and verify the signed delivery receipt. |
| `ahp secure network send EVT-ID ... --url URL --token-file FILE` | Publish a secure envelope through the HTTP/HTTPS carrier. |
| `ahp secure network receive ...` | Download secure envelopes and upload signed receipts. |
| `ahp secure network confirm ...` | Download and validate receipts for the sender. |
| `ahp hub serve --data-dir DIR --token-file FILE` | Run the reference immutable encrypted-object carrier. |

Remote URLs require HTTPS. HTTP is accepted only on loopback. Token and private
key files must remain outside Git and deny group/other access on POSIX.

## Records

| Command | Meaning |
|---|---|
| `ahp record add KIND --title TEXT` | Create a typed decision, task, bug, risk, QA, requirement, or evidence record. |
| `ahp record list [KIND]` | List records by kind and status. |
| `ahp record close RECORD-ID --status STATUS` | Close a mutable record with an explicit status. |
| `ahp record supersede DECISION-ID --title TEXT` | Replace an accepted decision prospectively. |

The 1.2 forms `record KIND`, `list`, `close`, and `supersede` remain aliases.
Accepted decisions are superseded, never rewritten.

## Handoff, sync, locks, and adapters

| Category | Commands |
|---|---|
| Handoff | `handoff create`, `handoff inspect`, `handoff receive` |
| Sync | `sync check [--require-remote]` |
| Locks | `lock acquire`, `lock release` |
| Adapters | `adapter list`, `adapter install PLATFORM [--apply]` |

Handoff and sync commands never fetch, switch, merge, commit, or push. Adapter
installation remains plan-first and collision-aware.

## IDE conversation contract

An installed adapter may expose semantic chat forms such as:

```text
/ahp project check
/ahp session checkpoint summary="Boundary validated" next="Message Codex"
/ahp message send to=codex text="Continue from the verified boundary"
/ahp message inbox for=cursor
/ahp message reply EVT-... text="Received and verified"
/ahp relay send EVT-... channel="/shared/ahp-relay"
/ahp relay wait as=cursor channel="/shared/ahp-relay"
/ahp relay confirm as=codex channel="/shared/ahp-relay"
/ahp agent ask claude question="Review this implementation read-only"
/ahp conversation open title="Architecture review" participants="codex,claude"
/ahp conversation send room=conv-... text="Review the migration risk"
/ahp conversation inbox room=conv-... for=claude
/ahp conversation wait room=conv-... for=codex timeout=60
```

The adapter translates the request to the repository-installed CLI, executes
it when the host has a terminal, and reports actual output in the same chat. A
model response without CLI or receiver evidence is not execution or delivery.
IDE chat processes may not inherit variables exported in an integrated terminal.
Provision relay credentials through the host process environment, a secret
manager, or `--secret-file`; never paste real credentials into chat.

## Concurrency and authority

All writes accept:

```bash
--expected-head <git-commit>
--expected-state <ahp-state-digest>
```

A mismatch stops the write. No CLI or chat form authorizes commit, push, pull,
merge, deploy, publication, deletion, payment, or access to secrets.
