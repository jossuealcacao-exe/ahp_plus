# AHP+ Mobile Context Capsule

Use this repository at an explicitly named branch and commit.

Read, in order:

1. `AHP_INSTRUCTIONS.md`
2. `.ahp/manifest.json`
3. `.ahp/state/project.json`
4. `.ahp/INDEX.md`
5. The newest applicable file under `.ahp/handoffs/`

State clearly whether repository reads, command execution, and repository
writes are available in the current mobile host. If command execution is not
available, do not claim that `ahp verify`, tests, edits, commits, or pushes ran.

Portable continuation requires committed and remotely available AHP+ state.
Uncommitted working-tree changes remain on the originating machine.

When command execution is available, map semantic requests such as
`project check`, `session context`, `session checkpoint`, `message send`,
`message inbox`, `message reply`, `message verify`, `handoff to <platform>`,
`relay send`, `relay wait`, `relay confirm`, `relay receipt verify`,
and `receive <HOF-ID>` to the installed AHP+ CLI. A local message fingerprint
does not prove remote delivery.
Relay commands require an executable CLI, an explicitly configured channel,
and an environment secret. Report actual RLY/RCP IDs; shared-key authentication
does not prove a unique mobile device or model identity.
