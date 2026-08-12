# Security policy

Do not report secrets by placing them in AHP+ records, examples, issues, or test
fixtures. Report suspected vulnerabilities privately to the repository owner
until a public security contact is configured.

AHP+ does not read `.env` files deliberately. Its secret scanner is heuristic
and cannot prove that a repository is free of secrets.

The CLI never performs Git network operations. Review package source, release
checksums, and the exact tag before installation from GitHub.
