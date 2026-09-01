# Architecture

```text
AI host
  -> platform adapter
    -> AHP+ CLI
      -> protocol core
        -> .ahp typed state
        -> local continuity-event journal
        -> Git inspector
          -> Git commit and remote transport

Optional provider boundary:
  local journal -> authenticated relay adapter -> receiver receipt
```

The protocol is normative. The Node.js CLI is the reference implementation.
Adapters translate host conventions but cannot change protocol meaning.

## Boundaries

- Core owns validation, identity, integrity, records, checkpoints, continuity
  events, readiness, and handoff.
- Git inspection is read-only and never invokes network or history mutation.
- `.ahp/` contains portable state; cache and temporary directories are ignored.
- Adapters are installed with plan/apply semantics and collision backups.
- Pangea and other orchestrators consume a pinned AHP+ version rather than
  maintaining a forked runtime.
- A realtime relay is an optional transport adapter. It cannot redefine Git
  anchoring, evidence, authority, or receiver verification.

## Scalability

Records, checkpoints, and continuity events are independent files to reduce merge conflicts. The
human-readable `INDEX.md` is derived. A future compatible implementation may
add a local ignored index under `.ahp/cache/`; the cache must never become a
truth source.
