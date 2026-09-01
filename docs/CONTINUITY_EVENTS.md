# Continuity Events and cross-platform messaging

AHP+ 1.2 introduces a local append-only journal of Continuity Event Capsules.
The journal preserves operational boundaries between agents without copying a
whole chat or treating model prose as execution evidence.

## What the fingerprint means

Every capsule is sealed with AHP+ Canonical JSON v1 and SHA-256. The resulting
`integrity.digest` is its fingerprint. The next event in the session records
both the parent event ID and that fingerprint.

This causal chain can detect:

- modification of a capsule;
- a missing parent;
- substitution of a parent with different content;
- duplicate or reordered events when sequence and parent links are checked.

SHA-256 does not authenticate Claude, Codex, ChatGPT, a user, or a device. An
actor field is a declaration until a future transport supplies authenticated
identity or a signature.

## Local usage

```bash
npx --no-install ahp event append . \
  --type DIRECTIVE \
  --session cross-agent \
  --from claude \
  --to codex \
  --actor "Claude" \
  --platform claude \
  --summary "Do not begin the next phase" \
  --status REQUESTED \
  --authority USER_CONFIRMED

npx --no-install ahp event list . --session cross-agent
npx --no-install ahp event verify EVT-... .
```

The second event in the same session automatically links to the latest event.
Use `--parent EVT-...` for an explicit causal parent or `--no-parent` to begin a
new causal chain deliberately.

## What should become an event

Capture directives and restrictions, decisions, scope changes, attempted or
observed actions, errors, blockers, validations, checkpoints, handoffs,
capability changes, and selected operational messages. Do not capture greetings,
repeated summaries, hidden reasoning, secrets, or full raw conversations by
default.

`MESSAGE` is available for a durable operational message between platforms. It
does not mean that AHP+ delivered the message in realtime.

`EXECUTED` and `VERIFIED` events require one or more `EVD-...` references. The
local Core can create only `LOCAL_CAPTURED`, `CONFLICTED`, or `REDACTED` events;
it refuses to self-assert `REMOTE_AVAILABLE`, `GIT_ANCHORED`, or `RECEIVED`.

## Three separate layers

1. **Local journal:** implemented in 1.2 under `.ahp/events/`. It can describe
   the current working tree and remains local until transported.
2. **Authenticated relay:** not implemented by Core. A future provider may use
   A2A, MCP, or another transport for low-latency exchange.
3. **Git anchoring:** remains explicitly authorized. Commit and push make
   reviewed capsules auditable and portable; event creation never grants that
   authority.

A relay must add authenticated project/device identity, encryption, access
control, replay protection, redaction, retention, tombstones, idempotency, and
independent receiver receipts. `REMOTE_AVAILABLE` is not `GIT_ANCHORED`, and a
sender must not claim `RECEIVED` without receiver-side evidence.

## Transport states

| State | Meaning |
|---|---|
| `LOCAL_CAPTURED` | Capsule exists only in the observed local state. |
| `SYNC_PENDING` | An authorized relay transfer is pending. |
| `REMOTE_AVAILABLE` | A relay reports the capsule available remotely. |
| `GIT_ANCHORED` | The capsule is included in an identified Git boundary. |
| `RECEIVED` | An independent receiver receipt exists. |
| `CONFLICTED` | Causal or semantic conflict blocks canonical anchoring. |
| `REDACTED` | Content was minimized or withheld under privacy policy. |

These states describe transport and review, not authority to modify the project.
