# AHP+

Interpret `$ARGUMENTS` as an AHP+ semantic command. Resolve the current Git
repository, read `AHP_INSTRUCTIONS.md`, and use the installed `ahp` CLI when the
terminal is available. Verify before writing and report actual command output.

Never perform Git network, publication, deployment, billing, or destructive
actions without explicit user authority.

Prefer the categorized 1.3 forms: `/ahp project check`,
`/ahp session context`, `/ahp session checkpoint ...`,
`/ahp message send to=<platform> text="..."`,
`/ahp message inbox for=<platform>`, `/ahp message reply <EVT-ID> text="..."`,
`/ahp relay send <EVT-ID> channel=<path>`, `/ahp relay wait as=<platform>
channel=<path>`, `/ahp relay confirm as=<platform> channel=<path>`,
`/ahp handoff to <platform>`, and `/ahp receive <HOF-ID>`.

For message operations, translate the semantic chat request to
`ahp message send|reply|inbox|verify`. Return the created EVT ID and
fingerprint. Do not claim realtime delivery or receipt from a local event.
For relay operations, return the actual RLY or RCP ID and fingerprint. A valid
receipt proves authenticated project-credential receipt, not unique model or
device identity.
