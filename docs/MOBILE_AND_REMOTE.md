# Mobile and remote continuity

Mobile continuation is a capability matrix, not a universal promise.

| Host capability | AHP+ behavior |
|---|---|
| Repository read + shell | Full verify, context, receive, and checkpoint. |
| Repository read only | Consume committed `INDEX.md`, handoff, and continuity-event files. |
| Uploaded files only | Consume an explicit capsule tied to a named commit. |
| No repository access | The handoff cannot be verified. |

The receiving agent must state which row applies. A platform-specific chat
memory does not prove repository state.

If the originating session ends abruptly, continuity reaches only the latest
persisted checkpoint. If the checkpoint is not committed and available from a
remote, it remains local to the originating machine.

A future authenticated relay may make a Continuity Event Capsule remotely
available before Git anchoring. That proves only relay availability. A mobile
host without the repository and shell still cannot verify the originating
working tree, and receipt requires independent receiver-side evidence.
