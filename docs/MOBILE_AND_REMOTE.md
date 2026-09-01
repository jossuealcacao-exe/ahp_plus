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

The AHP+ 1.3 relay may make a Continuity Event Capsule available before Git
anchoring. `REMOTE_AVAILABLE` proves only that the configured carrier accepted
the authenticated envelope. A mobile host without the repository and shell
still cannot verify the originating working tree. `RECEIVED` requires a valid
receiver-created RCP receipt; the reference shared-secret HMAC does not prove a
unique mobile device or model identity.

AHP+ 1.4 secure relay adds device-key assurance and payload encryption. A
remote carrier may therefore transfer selected events without seeing their
content, but the receiving host still needs the repository state, its private
device key, and the sender's committed public identity to complete verification.
A signed `SRC` receipt proves possession of the registered receiver device key;
it does not prove which human or exact AI model operated that device.
