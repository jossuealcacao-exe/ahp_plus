# Pangea migration

Pangea 1.0 embeds AHP+ under `/agent`. The 1.1 CLI detects that layout but keeps
it read-only.

Plan from the exact Pangea Git root:

```bash
ahp migrate --plan
```

After reviewing the source, destination, and counts:

```bash
ahp migrate --apply
ahp verify --strict
```

The migration creates `.ahp/`, normalizes supported records and handoffs, and
archives unsupported metadata inside `.ahp/archive/`. It does not remove or
modify `/agent`.

Pangea integration must occur in a separate reviewed change: pin the AHP+
package version, replace the bundled runtime, validate every project repository
independently, and only then consider legacy cleanup.
