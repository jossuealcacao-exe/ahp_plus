# AHP+

**Uno para controlar a todos.**

AHP+ (Agent Handoff Protocol Plus) is a Git-backed protocol and reference CLI
for preserving project state, decisions, evidence, checkpoints, authority, and
handoffs across AI platforms.

The model, account, IDE, and chat can change. The repository remains the source
of truth.

## Status

`1.1.0-emancipation.1` is the current public engineering prerelease. It
supersedes `.0` with verified shallow-clone CI and native Windows support. The
CLI and protocol are distributed under Apache-2.0. GitHub installation is
supported; the npm registry package has not been published.

## Core invariant

One AHP+ instance belongs to one Git repository. Workspace orchestrators may
aggregate instances, but they must not substitute a parent repository's branch
or commit for the active project's Git identity.

## Requirements

- Git
- Node.js 20 or newer
- No runtime dependencies

## Local installation

```bash
npm install --save-dev /absolute/path/to/ahp_plus
npx ahp init --owner "Your name" --project your-project
```

Initialization records the `HEAD` that existed before the new package and
`.ahp` files are committed. After reviewing and committing those files, anchor
the canonical state to that commit, then commit the state-only envelope:

```bash
npx ahp set-state \
  --confidence USER_CONFIRMED \
  --next-action "Create the first verified checkpoint"

npx ahp verify --strict
```

Git commits and pushes remain deliberate user actions; AHP+ never performs
them. A commit that changes project files after the recorded `base_commit` is
reported as stale until `ahp set-state` explicitly accepts the new boundary.

During development of AHP+ itself:

```bash
node /absolute/path/to/ahp_plus/bin/ahp.mjs init . \
  --owner "Your name" \
  --project your-project
```

## GitHub installation

Install the reviewed GitHub prerelease directly by tag:

```bash
npm install --save-dev github:jossuealcacao-exe/ahp_plus#v1.1.0-emancipation.1
npx ahp init --owner "Your name" --project your-project
```

## First heartbeat

```bash
ahp root
ahp doctor
ahp verify --strict
ahp status
ahp context --format markdown --budget 8000
```

`ahp root` resolves the nearest Git repository first. It never climbs out of a
nested Git repository to borrow AHP+ state from a parent workspace.

## Continuity workflow

```bash
ahp checkpoint \
  --session codex-feature-auth \
  --platform codex \
  --actor "Codex" \
  --summary "Validated the auth boundary" \
  --next-action "Implement the token refresh test"

ahp handoff create \
  --from codex \
  --to cursor \
  --session codex-feature-auth \
  --summary "Continue from the validated auth boundary"

ahp handoff receive HOF-...
```

## Portability classes

| Status | Meaning |
|---|---|
| `LOCAL_ONLY` | No commit exists or the working tree contains untransported changes. |
| `PUSH_REQUIRED` | The state is committed but no synchronized upstream is proven. |
| `REMOTE_DIVERGED` | The receiving branch must be reconciled. |
| `REMOTE_READY` | HEAD is clean and synchronized with its configured upstream. |

AHP+ does not execute `pull`, `push`, `commit`, `merge`, deploy, publication, or
destructive commands. It reports what is required and leaves authority with the
user and host platform.

## Platform adapters

Adapter installation is plan-only by default:

```bash
ahp adapter install all
ahp adapter install all --apply
```

Available adapters: generic `AGENTS.md`, Claude Code, Cursor, OpenCode, Codex,
and a mobile/ChatGPT context capsule. Existing files are preserved; collisions
stop installation unless explicitly reviewed with `--replace`.

## Protocol boundary

AHP+ complements, rather than replaces:

- `AGENTS.md` for durable agent instructions.
- MCP for tools, resources, and prompts.
- A2A for live remote-agent communication.
- ACP for editor-to-agent communication.

AHP+ owns repository-local durable state, evidence, authority boundaries,
checkpoints, portability classification, and receiver verification.

See [SPECIFICATION.md](SPECIFICATION.md), [docs/COMMANDS.md](docs/COMMANDS.md),
and [docs/CONFORMANCE.md](docs/CONFORMANCE.md).
