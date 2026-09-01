@AHP_INSTRUCTIONS.md

Use AHP+ checkpoints and handoffs for portable memory. Claude auto-memory is
machine-local and must not override committed AHP+ state.

Map requests such as `project check`, `session context`, `session checkpoint`,
`message send`, `message inbox`, `message reply`, `message verify`,
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
