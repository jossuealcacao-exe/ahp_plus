# Command contract

## Repository

| Command | Meaning |
|---|---|
| `ahp init` | Initialize `.ahp/` in the current Git repository. |
| `ahp root` | Report the resolved Git and state roots. |
| `ahp doctor` | Check Git identity, scope, layout, and validation. |
| `ahp verify --strict` | Validate structure, semantics, references, secrets, and integrity. |
| `ahp status` | Report effective state, Git, locks, and portability. |
| `ahp sync check` | Inspect upstream synchronization without network mutation. |

## Context

| Command | Meaning |
|---|---|
| `ahp context` | Return bounded machine-readable context. |
| `ahp context --format markdown` | Return a portable human/model context capsule. |
| `ahp brief` | Regenerate `.ahp/INDEX.md`. |
| `ahp checkpoint` | Persist a per-session recovery point. |
| `ahp history` | List checkpoints and handoffs. |
| `ahp set-state` | Update stable project state after concurrency preflight. |

## Governance

`record`, `list`, `close`, and `supersede` manage typed records. Use
`record evidence` for reproducible receipts. Accepted decisions are superseded,
not rewritten.

## Handoff

`handoff create` writes a sealed manifest, `handoff inspect` validates it, and
`handoff receive` compares it with the receiving repository. None of these
commands fetches, switches, merges, commits, or pushes.

## Concurrency

All writes accept:

```bash
--expected-head <git-commit>
--expected-state <ahp-state-digest>
```

Both values are returned by status/context. A mismatch stops the write.

Locks use `lock acquire` and `lock release`. Released locks are archived rather
than deleted.
