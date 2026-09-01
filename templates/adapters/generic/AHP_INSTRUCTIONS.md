# AHP+ Project Continuity

This repository uses AHP+ as its Git-backed governance and handoff state.

Before substantive work:

1. Resolve the repository with `ahp project root`.
2. Resolve the local CLI with `npx --no-install ahp` or the platform-specific
   `node_modules/.bin` shim, then run `project check`.
3. Read `.ahp/manifest.json`, `.ahp/state/project.json`, and `.ahp/INDEX.md`.
4. Inspect Git branch, commit, upstream, and working tree.
5. Create checkpoints during material work and a handoff before changing platforms.
6. Record only material operational boundaries as continuity events; do not
   copy whole chats or hidden reasoning.

Useful commands:

```bash
ahp project check
ahp project status
ahp session context --format markdown --budget 8000
ahp session checkpoint --summary "..." --next-action "..."
ahp message send "..." --from current-agent --to next-agent --session project-chat
ahp message inbox --for current-agent --session project-chat
ahp message reply EVT-... "..." --from current-agent
ahp message verify EVT-...
ahp relay send EVT-... --channel /protected/shared/ahp-relay
ahp relay wait --as current-agent --channel /protected/shared/ahp-relay
ahp relay confirm --as current-agent --channel /protected/shared/ahp-relay
ahp relay receipt verify RCP-...
ahp agent ask claude "Review the current boundary read-only" --from codex
ahp identity list
ahp secure network receive --as-device DEV-... --url https://relay.example --token-file /protected/ahp.token
ahp handoff create --from current-agent --to next-agent --summary "..."
ahp handoff receive HOF-...
```

Semantic requests supported by adapters include `project check`,
`session context`, `session checkpoint`, `message send`, `message inbox`,
`message reply`, `message verify`, `relay send`, `relay wait`, `relay confirm`,
`relay receipt verify`, `agent ask`, `secure network send`,
`handoff to <platform>`, and `receive <HOF-ID>`.
Translate them to the installed CLI and report actual
output, including EVT IDs and fingerprints.

`message` commands capture selected operational content. Do not copy whole
chats or hidden reasoning. A local fingerprint does not prove realtime delivery
or receiver acknowledgement.

Relay output must include observed RLY/RCP IDs and fingerprints. The reference
HMAC authenticates a shared project secret; it does not prove a unique model or
device identity, and the file channel is not encrypted.
IDE chat processes may not inherit integrated-terminal variables. Use host
secret injection or `--secret-file` with a protected credential outside Git;
never paste real credentials into chat.

If the platform cannot run commands, treat committed `.ahp/INDEX.md` and the
handoff JSON as a read-only capsule. Never claim a command, test, edit, commit,
push, or deploy occurred without tool evidence.

AHP+ never grants authority to commit, push, pull, merge, deploy, publish, or
perform destructive operations.
