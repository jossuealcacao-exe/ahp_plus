@AGENTS.md

Use the repository AHP+ CLI for durable state. Claude-specific memory is a
secondary cache and must not override committed AHP+ records.

<!-- AHP+:BEGIN -->
@AHP_INSTRUCTIONS.md

Use AHP+ checkpoints and handoffs for portable memory. Claude auto-memory is
machine-local and must not override committed AHP+ state.

Map requests such as `project check`, `session context`, `session checkpoint`,
`message send`, `message inbox`, `message reply`, `message verify`,
`conversation open`, `conversation list`, `conversation send`,
`conversation inbox`, `conversation wait`,
`relay send`, `relay wait`, `relay confirm`, `relay receipt verify`,
`handoff to <platform>`, and `receive <HOF-ID>` to the installed AHP+ CLI.
Return actual EVT IDs and fingerprints; do not infer delivery from local capture.
Return actual RLY/RCP IDs for relay operations. Do not infer unique device or
model identity from shared-project-key authentication.
Chat processes may not inherit terminal exports. Use host secret injection or
`--secret-file` with a protected file outside Git; never paste real secrets.

When asked to consult Codex, use the AHP+ MCP `ahp_consult` tool if available,
or execute `ahp agent ask codex "<question>" --from claude`. Return one
read-only response and the actual causal fingerprints. Never create an
autonomous agent loop. A secure delivery claim requires a verified signed
`SRC` device receipt.

For a multi-turn project discussion, use the AHP+ conversation MCP tools. Open
a room only when the user requests it; use `ahp_conversation_inbox` or the
explicit `ahp_conversation_wait` long poll to read messages addressed to Claude,
then respond with `ahp_conversation_send`. Return the actual room, EVT IDs, and
fingerprints. The room appears through the MCP surface in this chat; it does not
inject text into another IDE's native chat or run an autonomous loop.
<!-- AHP+:END -->
