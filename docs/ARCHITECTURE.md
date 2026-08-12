# Architecture

```text
AI host
  -> platform adapter
    -> AHP+ CLI
      -> protocol core
        -> .ahp typed state
        -> Git inspector
          -> Git commit and remote transport
```

The protocol is normative. The Node.js CLI is the reference implementation.
Adapters translate host conventions but cannot change protocol meaning.

## Boundaries

- Core owns validation, identity, integrity, records, checkpoints, and handoff.
- Git inspection is read-only and never invokes network or history mutation.
- `.ahp/` contains portable state; cache and temporary directories are ignored.
- Adapters are installed with plan/apply semantics and collision backups.
- Pangea and other orchestrators consume a pinned AHP+ version rather than
  maintaining a forked runtime.

## Scalability

Records and checkpoints are independent files to reduce merge conflicts. The
human-readable `INDEX.md` is derived. A future compatible implementation may
add a local ignored index under `.ahp/cache/`; the cache must never become a
truth source.
