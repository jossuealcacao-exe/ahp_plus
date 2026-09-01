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
actor field remains a declaration unless a provider supplies separately
verifiable device or account identity.

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

AHP+ 1.3 adds a shorter, message-specific surface over the same sealed event:

```bash
npx --no-install ahp message send "Continue from the verified boundary" \
  --from claude --to codex --session cross-agent
npx --no-install ahp message inbox . --for codex --session cross-agent
npx --no-install ahp message reply EVT-... "Received" --from codex
npx --no-install ahp message verify EVT-... .
```

`reply` verifies the referenced event before writing and preserves its session,
ID, and fingerprint as the causal parent. `inbox` and `outbox` are filtered
views over the local append-only journal.

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

IDE adapters may translate `/ahp message ...` or equivalent natural-language
requests into these CLI commands and report the result in the same chat. This
improves operation without changing the evidence boundary: an EVT ID and
fingerprint prove local capture, not remote delivery.

`EXECUTED` and `VERIFIED` events require one or more `EVD-...` references. The
local Core can create only `LOCAL_CAPTURED`, `CONFLICTED`, or `REDACTED` events;
it refuses to self-assert `REMOTE_AVAILABLE`, `GIT_ANCHORED`, or `RECEIVED`.

## Relay and receipt in 1.3

Set a project-shared secret of at least 32 bytes in each authorized process.
The value is read from the environment and is never written to `.ahp/`:

```bash
export AHP_RELAY_SECRET='replace-with-a-random-project-secret-of-32-plus-bytes'
```

If an IDE chat process does not inherit terminal variables, provision a local
credential file outside Git and pass `--secret-file /protected/path`. AHP+ reads
it at execution time, rejects symlinks and unsafe POSIX permissions, and does
not copy it into protocol state. Never paste a real relay secret into chat.

The memorable path is:

```bash
# Sender: seal and publish the selected event.
ahp relay send EVT-... --channel /shared/ahp-relay

# Receiver: wait for and import it, preserving the EVT fingerprint.
ahp relay wait --as codex --channel /shared/ahp-relay --timeout 30

# Sender: import the receiver-created receipt.
ahp relay confirm --as cursor --channel /shared/ahp-relay

# Verify the receipt and its envelope/message linkage.
ahp relay receipt verify RCP-...
```

Advanced operators can split `send` into `prepare` plus `push`, use `pull`
instead of `receive`, and use `receipts` instead of `confirm`. Repeating push,
receive, or confirmation is idempotent. A conflicting replay, changed payload,
wrong secret, wrong project, wrong destination, expired envelope, or missing
causal parent is rejected.

There are three distinct fingerprints:

1. `EVT-...`: immutable message content and causal identity.
2. `RLY-...`: authenticated delivery attempt, destination, nonce, and expiry.
3. `RCP-...`: receiver-created observation tied to both fingerprints.

The HMAC profile proves possession of a shared project credential. It does not
prove a unique device, human, or model identity; those actor fields remain
declarative. The file-channel adapter is a reference transport with a durable
spool and polling-based reconnect. It is not an encrypted Internet relay and
does not provide confidentiality. Use a protected directory; a production
network adapter must add TLS or equivalent confidentiality and access control.

## Device identity, encryption, and consultation in 1.4

AHP+ 1.4 adds a stronger optional profile. `ahp setup` creates separate Codex
and Claude device identities whose Ed25519/X25519 private keys stay outside Git.
`secure send/receive/confirm` encrypts the full EVT with AES-256-GCM and returns
a receiver-signed `SRC` receipt. The network form transports the same `SEC` and
`SRC` objects through HTTPS without exposing event content to the carrier.

The MCP Live Bridge handles a different need: one agent can request exactly one
read-only opinion from the other inside the originating IDE chat. It records a
`CONSULT_REQUEST` and causally linked `CONSULT_RESPONSE`; it is not a continuous
conversation and cannot authorize project mutation.

## Four separate layers

1. **Local journal:** implemented in 1.2 under `.ahp/events/`. It can describe
   the current working tree and remains local until transported.
2. **Authenticated relay:** implemented in 1.3 as transport-neutral envelopes,
   HMAC authentication, a reference file channel, idempotent import, and
   receiver-created receipts. A network provider may carry the same documents.
3. **Secure device relay:** implemented in 1.4 with device keys, encrypted
   events, signed receipts, and file plus HTTP/HTTPS carriers.
4. **Git anchoring:** remains explicitly authorized. Commit and push make
   reviewed capsules auditable and portable; event creation never grants that
   authority.

A production relay must add transport confidentiality, access control,
redaction, retention, and any required deletion policy. Core supplies project
credential authentication, expiry, nonce-bearing attempts, collision checks,
idempotency, and receiver-created receipts. `REMOTE_AVAILABLE` is not
`GIT_ANCHORED`, and a sender must not claim `RECEIVED` without a valid receipt.

## Transport states

| State | Meaning |
|---|---|
| `LOCAL_CAPTURED` | Capsule exists only in the observed local state. |
| `SYNC_PENDING` | An authorized relay transfer is pending. |
| `REMOTE_AVAILABLE` | A relay reports the capsule available remotely. |
| `GIT_ANCHORED` | The capsule is included in an identified Git boundary. |
| `RECEIVED` | A valid receiver-created receipt exists and matches the envelope and event fingerprints. |
| `CONFLICTED` | Causal or semantic conflict blocks canonical anchoring. |
| `REDACTED` | Content was minimized or withheld under privacy policy. |

These states describe transport and review, not authority to modify the project.
