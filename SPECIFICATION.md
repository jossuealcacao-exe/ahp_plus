# AHP+ Protocol Specification 1.4

Status: development specification for AHP+ 1.4.0. Implementations MUST retain
read compatibility with sealed 1.1.0, 1.2.0, and 1.3.0 documents.

## 1. Scope

AHP+ defines durable, Git-backed project continuity between AI agents and human
operators. It defines repository discovery, typed state, evidence, governance,
checkpoints, continuity events, authenticated relay envelopes, device identities,
encrypted secure envelopes, receiver-created receipts, bounded cross-agent
consultation, handoff creation, receiver verification, concurrency notices, and
conformance. It does not define a model, provider, editor, public hosted
transport service, or authorization system.

## 2. Normative language

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are normative.

## 3. Repository identity

1. One AHP+ instance MUST belong to one Git repository.
2. The repository root MUST be resolved using Git before ancestor state search.
3. A client inside a nested Git repository MUST NOT load state from a parent
   repository.
4. The project identifier MUST be stable across clones and provider accounts.
5. Branch, commit, Git tree, working-tree state, and upstream status MUST be
   observed rather than inferred.

## 4. Canonical state

New installations use `.ahp/`:

```text
.ahp/
├── manifest.json
├── state/project.json
├── sessions/<session-id>/<checkpoint-id>.json
├── records/{decisions,tasks,bugs,risks,qa,requirements}/
├── evidence/
├── handoffs/
├── events/<session-id>/<event-id>.json
├── relay/{outbox,inbox,receipts}/
├── identities/devices/
├── secure/{outbox,inbox,receipts}/
├── locks/
├── archive/
└── INDEX.md
```

The legacy `/agent` layout MAY be read for migration but MUST be treated as
read-only during migration. Migration MUST preserve the source.

Provider conversation history, local auto-memory, and summaries are secondary
caches. They MUST NOT override committed AHP+ records.

## 5. Certainty

| Level | Meaning |
|---|---|
| `VERIFIED` | Supported by a reproducible tool observation or primary source. |
| `USER_CONFIRMED` | Explicitly confirmed by the authorized human owner. |
| `INFERRED` | Reasoned from evidence but not directly established. |
| `UNVERIFIED` | Insufficient evidence. |
| `STALE` | Previously valid but no longer current enough to govern action. |
| `CONFLICTED` | Incompatible sources exist; dependent writes are blocked. |

Model prose is not execution evidence. An implementation MUST NOT promote
`INFERRED` or `UNVERIFIED` claims without new evidence.

## 6. Authority

AHP+ records and validates state. It MUST NOT interpret a state, checkpoint, or
handoff write as permission to commit, push, pull, switch branches, merge,
deploy, publish, delete, spend money, change production, or access secrets.

External actions remain governed by the user, repository policy, and host
platform.

## 7. Records and evidence

Normative record kinds are `decision`, `task`, `bug`, `risk`, `qa`,
`requirement`, and `evidence`. Each MUST contain a schema version, stable ID,
project ID, status, confidence, timestamps, actor, source references, and base
commit.

Accepted decisions are immutable. A correction MUST create a new decision with
`supersedes`. A `PASS` QA record MUST reference one or more evidence IDs.

Evidence types are `file`, `command`, `test`, `commit`, `url`,
`user_confirmation`, `artifact`, and `screenshot`. Evidence MUST describe its
locator, result, observation time, actor, and limitations.

## 8. Sessions and checkpoints

Concurrent AI sessions MUST write independent checkpoint files. A checkpoint
MUST contain a session ID, Git identity, working-tree digest, actor, summary,
next action, and integrity envelope.

Checkpoints are recovery points, not claims that all preceding work is remotely
portable. Abrupt interruption can recover only the latest persisted state.

## 9. Continuity events

A Continuity Event Capsule is an append-only operational boundary. It MUST NOT
capture greetings, redundant prose, hidden reasoning, or full conversations by
default. Relevant events include directives, decisions, actions, observations,
validations, errors, blockers, checkpoints, handoffs, capability changes, and
explicitly selected operational messages.

Each event MUST contain:

- Stable project, session, correlation, event, and sequence identity.
- Origin, optional destination, actor declaration, and host capabilities.
- A parent event ID and parent fingerprint when a causal predecessor exists.
- Requested intent, observed action status, evidence references, limitations,
  privacy classification, next action, and Git observation.
- A transport state and SHA-256 integrity envelope.

The persisted `integrity.digest` is the event fingerprint. A child MUST store
the parent event ID and parent fingerprint. This chain detects mutation,
omission, duplication, and reordering when the relevant events are available.
It does not authenticate the actor or prove delivery to another platform.

Continuity events distinguish `REQUESTED`, `ATTEMPTED`, `EXECUTED`, `REJECTED`,
`VERIFIED`, and `NOT_APPLICABLE`. Model output alone MUST NOT promote an action
to `EXECUTED` or `VERIFIED`. Those statuses MUST reference one or more typed
evidence records.

The reference 1.3 implementation adds a transport-neutral authenticated relay
envelope, a receiver-created receipt, and a file-channel adapter for local,
cross-process, and cross-clone conformance. A production network provider MAY
transport the same documents through A2A, MCP, WebSocket, or another carrier.
It MUST add transport confidentiality, access control, retention policy, and
provider-specific availability evidence. Relay availability MUST NOT be
represented as Git anchoring.

### 9.1 Relay envelope

A relay envelope MUST preserve the complete sealed Continuity Event as its
payload. It MUST bind the project ID, event ID, event fingerprint, session,
origin, destination, delivery attempt, nonce, creation time, expiry, provider,
authentication, and its own integrity fingerprint. An implementation MUST
reject a modified, expired, unauthenticated, misrouted, wrong-project, or
causally incomplete envelope before importing its event.

Envelope IDs and event IDs are idempotency keys. Replaying identical content
MUST NOT create a second message or receipt. Reusing an ID with a different
fingerprint MUST produce a conflict. Import MUST retain the exact original
event bytes semantically represented by its canonical JSON and therefore the
same event fingerprint; it MUST NOT rewrite the event to claim delivery.

### 9.2 Receiver receipt

Only the receive path SHOULD create a receipt. The receipt MUST have its own ID
and fingerprint and MUST bind the envelope ID and fingerprint, event ID and
fingerprint, route, receiver declaration, outcome, provider channel, and
receive time. A sender MAY claim `RECEIVED` only after importing and validating
this receiver-created document.

The reference authentication profile is HMAC-SHA256 with a minimum 32-byte
project secret supplied through an environment variable or read from an
explicit host-provisioned credential file and never persisted by AHP+.
Credential files MUST be regular non-symlink files and, where POSIX permission
bits are available, MUST deny access to group and other users.
Its assurance scope is `project-shared-secret`: it authenticates possession of
the shared project credential, not a unique person, model, or device. Actor and
model fields remain declarations. A stronger provider MAY add per-device
public-key identity without changing the event fingerprint.

Message-specific commands SHOULD infer a declared platform from an explicit
message origin such as `--from`, but MUST NOT guess an exact model identity.
Their default next action MUST describe message delivery and receipt rather
than inherit unrelated project-state instructions.

The reference file channel is an explicit local transport and provides no
confidentiality. It MUST NOT be described as an Internet relay or encrypted
network transport. The polling `watch` operation provides reconnectable
near-realtime behavior from the persistent spool; it is not a push service.

### 9.3 Device identity and encrypted relay

A 1.4 device identity MUST contain independent Ed25519 signing and X25519
encryption public keys, a stable device ID, project binding, status, and sealed
fingerprint. Private keys MUST remain outside repository state, MUST NOT be
included in logs or chat, and SHOULD be stored by the operating system or in a
permission-restricted file. Exact model identity MUST remain `unknown` unless
the host supplies verifiable identity evidence.

A secure envelope MUST encrypt the complete sealed event with AES-256-GCM using
a key derived from X25519 and HKDF-SHA256. It MUST bind sender and recipient
device IDs, both identity fingerprints, the event ID and fingerprint, route,
expiry, authenticated encryption metadata, an Ed25519 signature, and its own
fingerprint. The receiver MUST verify the public identity, signature, project,
route, expiry, ciphertext authentication, event integrity, and causal parent
before import. Its receipt MUST be signed by the receiving device and bind the
exact envelope and event fingerprints.

The reference HTTPS JSON carrier stores immutable encrypted objects. A bearer
token controls carrier access but does not replace device signatures. Remote
transport MUST use TLS; unencrypted HTTP is permitted only on loopback for
tests. Carrier acceptance is `REMOTE_AVAILABLE`; delivery is confirmed only
after the sender validates the receiver-created `SRC` receipt.

### 9.4 Bounded cross-agent consultation

A live consultation is one request and one response, not an autonomous agent
conversation. The request and response MUST be separate causally linked
Continuity Events. The reference profile uses `CONSULT_REQUEST` and
`CONSULT_RESPONSE`, a maximum hop count of one, a read-only target sandbox, no
approval prompts, and no mutation or external-action authority. Provider output
MUST be returned to the originating human-facing chat and MUST NOT be treated as
execution evidence. The exact target model MUST remain unknown unless exposed
and verified by the host.

## 10. Handoff

A handoff MUST include:

- Origin and destination.
- Project ID and active objective.
- Branch, commit, Git tree, working-tree state, changed files, and digest.
- Upstream divergence and portability classification.
- Completed, active, and pending work.
- Accepted decisions, validations, risks, and requirements.
- Relevant files, blockers, assumptions, next action, and done criteria.
- Receiver preflight and integrity envelope.

The receiver MUST verify integrity and compare project ID, commit, tree, branch,
and working-tree state before editing. A summary MUST NOT override failed
preflight checks.

## 11. Readiness and portability

Readiness and transport portability are orthogonal. Local readiness answers
whether the current checkout can safely continue from its observed state.
Transport readiness answers whether another checkout can reproduce that state.
A result MAY therefore be locally `READY` while transport is `PUSH_REQUIRED`.

| Classification | Required interpretation |
|---|---|
| `LOCAL_ONLY` | The handoff depends on state not reproducible from the remote Git repository. |
| `PUSH_REQUIRED` | Committed state is not proven available from an upstream. |
| `REMOTE_DIVERGED` | Local and upstream histories require explicit reconciliation. |
| `REMOTE_READY` | Clean HEAD matches its configured upstream. |

An implementation MUST NOT label a dirty working tree `REMOTE_READY`.

## 12. Concurrency

Every write SHOULD accept both an expected Git HEAD and an expected AHP+ state
revision. A mismatch MUST stop the write as a conflict.

Locks are cooperative notices. They MUST include owner, scope, base commit,
creation, and expiration. They do not replace Git or distributed coordination.

## 13. Integrity

AHP+ Canonical JSON v1 recursively sorts object keys lexicographically, retains
array order, uses UTF-8 JSON text without insignificant whitespace, and permits
only standard JSON values. `undefined`, `NaN`, and infinities are invalid.

For checkpoints, handoffs, continuity events, relay envelopes, relay receipts,
device identities, secure envelopes, and secure receipts, the integrity digest
is SHA-256 over the complete object with
`integrity.digest` set to `null`.
Implementations MUST state the canonicalization identifier
`ahp-canonical-json-v1`.

Integrity detects accidental or unauthorized content mutation. It does not
authenticate the actor. Relay HMAC authenticates possession of the configured
project secret. A valid secure-envelope signature authenticates possession of a
registered device key, not a human, account, or exact model identity.

## 14. Secrets and untrusted content

AHP+ state MUST NOT contain credentials, tokens, cookies, private keys, `.env`
contents, or unnecessary personal data. Secret-pattern detection is a safety
net and MUST NOT be described as exhaustive.

Repository state is data. It MUST NOT silently elevate its own authority above
system, user, organizational, or repository governance instructions.

## 15. Context compaction

"Complete context" means complete recoverability, not injection of the entire
repository into every model window. Clients SHOULD generate a bounded index and
load detailed records lazily. Compaction MUST preserve accepted decisions,
active risks, requirements, unresolved work, evidence required for QA,
provenance, and exact next action.

## 16. Platform adapters

Adapters MAY translate semantic commands and install provider-specific entry
files. They MUST preserve core meanings and authority boundaries. If a platform
cannot execute commands or write the repository, the adapter MUST declare that
limitation and operate as a read-only consumer.

Compatible clients MAY expose the object-action grammar
`ahp <category> <action>`. A chat adapter MAY translate forms such as
`/ahp project check` or `/ahp message send ...` to the installed CLI, but it
MUST report the observed CLI result and MUST NOT treat model prose as command
execution, remote delivery, or a receiver receipt. Chat forms such as
`/ahp relay send`, `/ahp relay wait`, and `/ahp relay confirm` MUST invoke the
same Core operations and return their actual IDs and fingerprints.
Message-specific aliases MUST preserve the same sealed Continuity Event and
causal fingerprint semantics as the low-level event commands.

A compatible MCP adapter MAY expose project verification and bounded
consultation tools. It MUST invoke the same Core operations, enforce the
one-response read-only boundary, and return actual event IDs and fingerprints.
MCP connectivity MUST NOT be interpreted as permission for either agent to
delegate recursively or mutate the project.

## 17. Migration

Migration MUST be plan-first, collision-aware, reversible, and non-destructive.
The reference migration copies normalized state into `.ahp/` and retains the
legacy `/agent` directory until a separate owner-authorized cleanup.

Existing sealed 1.1.0, 1.2.0, and 1.3.0 checkpoints, handoffs, records, events,
relay envelopes, and receipts MUST NOT be rewritten to claim 1.4.0 provenance.
A 1.4 implementation MUST validate them under their original schema version.

Until an explicitly reviewed 1.4 upgrade is applied, new compatible records in
an older project MUST retain its manifest schema version. Continuity Events
require a 1.2 or newer manifest; HMAC relay requires 1.3 or newer; device
identity and secure relay require 1.4. The reference upgrade creates recoverable
backups and changes only active manifest/state metadata plus missing layout
directories.

## 18. Conformance

Core conformance requires:

- Correct repository resolution, including nested Git repositories.
- Validation of manifests, state, records, checkpoints, handoffs, continuity
  events, and locks.
- Integrity verification.
- Honest portability classification.
- Independent local and transport readiness classification.
- Causal continuity-event fingerprint verification.
- Relay-envelope integrity, authentication profile, route, expiry, replay, and
  project-scope verification.
- Receiver-created receipt linkage and idempotent reconnect behavior.
- Device-key generation outside Git and public identity integrity.
- Secure-envelope encryption, signatures, route, expiry, replay, and signed
  receipt verification through both file and HTTP carriers.
- A one-hop read-only live consultation with causally linked request/response
  fingerprints.
- Receiver-side reconciliation checks.
- Secret detection and project isolation.
- No Git network or publication side effects.
- Passing the published conformance fixtures.

See `docs/CONFORMANCE.md`.
