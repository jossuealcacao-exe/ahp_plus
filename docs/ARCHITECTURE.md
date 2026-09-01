# Architecture

```text
AI host
  -> platform adapter
    -> AHP+ CLI
      -> protocol core
        -> .ahp typed state
        -> local continuity-event journal
        -> relay outbox / inbox / receipts
        -> device public identities
        -> encrypted secure outbox / inbox / receipts
        -> Git inspector
          -> Git commit and remote transport

Transport boundary:
  local journal -> authenticated envelope -> provider channel -> receiver receipt
  local journal -> encrypted signed envelope -> HTTPS carrier -> signed device receipt

Live consultation boundary:
  IDE chat -> MCP stdio -> one read-only provider turn -> causal response event
```

The protocol is normative. The Node.js CLI is the reference implementation.
Adapters translate host conventions but cannot change protocol meaning.

## Boundaries

- Core owns validation, project identity, integrity, records, checkpoints,
  continuity events, relay envelopes/receipts, readiness, and handoff.
- Git inspection is read-only and never invokes network or history mutation.
- `.ahp/` contains portable state; cache and temporary directories are ignored.
- Adapters are installed with plan/apply semantics and collision backups.
- Pangea and other orchestrators consume a pinned AHP+ version rather than
  maintaining a forked runtime.
- The reference relay carrier is an explicit file channel with persistent spool
  and polling. Network carriers are optional adapters. Neither can redefine Git
  anchoring, evidence, authority, or receiver verification.
- Relay HMAC authenticates a project-shared credential. It does not establish a
  unique device, human, or model identity and it does not encrypt the payload.
- Secure relay uses Ed25519 device signatures, X25519/HKDF key agreement, and
  AES-256-GCM. It establishes possession of a registered device key, not a
  human or exact model identity.
- The bundled hub persists immutable ciphertext objects. It is not a public
  hosted service; operators supply storage, access token, TLS, and retention.
- Live consultation is deliberately one hop and read-only. It never becomes an
  autonomous cross-agent loop.

## Scalability

Records, checkpoints, continuity events, relay envelopes, and receipts are
independent files to reduce merge conflicts and enable idempotent import. The
human-readable `INDEX.md` is derived. A compatible implementation may add a
local ignored index under `.ahp/cache/`; the cache must never become a truth
source.
