# Contributing

AHP+ is distributed under Apache-2.0. Anyone may report friction,
documentation gaps, compatibility problems, and proposed improvements using
the process in [docs/COMMUNITY_FEEDBACK_ES.md](docs/COMMUNITY_FEEDBACK_ES.md).

Do not include secrets, private repository content, customer data, or complete
`.ahp/` directories in a public report. Use the repository owner's agreed
private channel for security findings or evidence that cannot be shared.

Code contributions must preserve protocol semantics, add tests for behavior
changes, and pass:

```bash
npm test
npm run conformance
npm run validate
npm run pack:dry-run
```

Commits, pushes, tags, releases, and package publication require explicit owner
approval.
