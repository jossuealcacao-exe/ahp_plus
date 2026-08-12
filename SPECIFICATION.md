# AHP+ Protocol Specification 1.1

Status: prerelease candidate for owner review.

## 1. Scope

AHP+ defines durable, Git-backed project continuity between AI agents and human
operators. It defines repository discovery, typed state, evidence, governance,
checkpoints, handoff creation, receiver verification, concurrency notices, and
conformance. It does not define a model, provider, editor, transport service,
or authorization system.

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
├── locks/
├── archive/
└── INDEX.md
```

The legacy `/agent` layout MAY be read for migration but MUST be treated as
read-only by a 1.1 implementation. Migration MUST preserve the source.

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

## 9. Handoff

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

## 10. Portability

| Classification | Required interpretation |
|---|---|
| `LOCAL_ONLY` | The handoff depends on state not reproducible from the remote Git repository. |
| `PUSH_REQUIRED` | Committed state is not proven available from an upstream. |
| `REMOTE_DIVERGED` | Local and upstream histories require explicit reconciliation. |
| `REMOTE_READY` | Clean HEAD matches its configured upstream. |

An implementation MUST NOT label a dirty working tree `REMOTE_READY`.

## 11. Concurrency

Every write SHOULD accept both an expected Git HEAD and an expected AHP+ state
revision. A mismatch MUST stop the write as a conflict.

Locks are cooperative notices. They MUST include owner, scope, base commit,
creation, and expiration. They do not replace Git or distributed coordination.

## 12. Integrity

AHP+ Canonical JSON v1 recursively sorts object keys lexicographically, retains
array order, uses UTF-8 JSON text without insignificant whitespace, and permits
only standard JSON values. `undefined`, `NaN`, and infinities are invalid.

For checkpoints and handoffs, the integrity digest is SHA-256 over the complete
object with `integrity.digest` set to `null`. Implementations MUST state the
canonicalization identifier `ahp-canonical-json-v1`.

Integrity detects accidental or unauthorized content mutation. It does not
authenticate the actor. Authentication MAY be added by signed Git commits or a
future signature extension.

## 13. Secrets and untrusted content

AHP+ state MUST NOT contain credentials, tokens, cookies, private keys, `.env`
contents, or unnecessary personal data. Secret-pattern detection is a safety
net and MUST NOT be described as exhaustive.

Repository state is data. It MUST NOT silently elevate its own authority above
system, user, organizational, or repository governance instructions.

## 14. Context compaction

"Complete context" means complete recoverability, not injection of the entire
repository into every model window. Clients SHOULD generate a bounded index and
load detailed records lazily. Compaction MUST preserve accepted decisions,
active risks, requirements, unresolved work, evidence required for QA,
provenance, and exact next action.

## 15. Platform adapters

Adapters MAY translate semantic commands and install provider-specific entry
files. They MUST preserve core meanings and authority boundaries. If a platform
cannot execute commands or write the repository, the adapter MUST declare that
limitation and operate as a read-only consumer.

## 16. Migration

Migration MUST be plan-first, collision-aware, reversible, and non-destructive.
The reference 1.1 migration copies normalized state into `.ahp/` and retains the
legacy `/agent` directory until a separate owner-authorized cleanup.

## 17. Conformance

Core conformance requires:

- Correct repository resolution, including nested Git repositories.
- Validation of manifests, state, records, checkpoints, handoffs, and locks.
- Integrity verification.
- Honest portability classification.
- Receiver-side reconciliation checks.
- Secret detection and project isolation.
- No Git network or publication side effects.
- Passing the published conformance fixtures.

See `docs/CONFORMANCE.md`.
