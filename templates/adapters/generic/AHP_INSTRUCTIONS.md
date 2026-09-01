# AHP+ Project Continuity

This repository uses AHP+ as its Git-backed governance and handoff state.

Before substantive work:

1. Resolve the repository with `ahp root`.
2. Resolve the local CLI with `npx --no-install ahp` or the platform-specific
   `node_modules/.bin` shim, then run `doctor` and `verify --strict`.
3. Read `.ahp/manifest.json`, `.ahp/state/project.json`, and `.ahp/INDEX.md`.
4. Inspect Git branch, commit, upstream, and working tree.
5. Create checkpoints during material work and a handoff before changing platforms.
6. Record only material operational boundaries as continuity events; do not
   copy whole chats or hidden reasoning.

Useful commands:

```bash
ahp status
ahp context --format markdown --budget 8000
ahp checkpoint --summary "..." --next-action "..."
ahp handoff create --from current-agent --to next-agent --summary "..."
ahp handoff receive HOF-...
```

Semantic requests supported by adapters include `doctor`, `verify strict`,
`context`, `status`, `checkpoint`, `handoff to <platform>`, and
`receive <HOF-ID>`. Translate them to the installed CLI and report actual
output.

If the platform cannot run commands, treat committed `.ahp/INDEX.md` and the
handoff JSON as a read-only capsule. Never claim a command, test, edit, commit,
push, or deploy occurred without tool evidence.

AHP+ never grants authority to commit, push, pull, merge, deploy, publish, or
perform destructive operations.
