# Remote Control All-in-One

Local-first browser control plane for CLI coding agents.

This project runs a local daemon, exposes a browser UI, and normalizes session control for built-in adapters such as Codex, Claude Code, and OpenCode.

> `docs/` is the authoritative product/architecture/release contract. Start there for implementation details.

## What it does

- launches and manages local agent sessions
- provides a browser workspace for transcripts, pending actions, policies, and settings
- persists normalized events and session snapshots for recovery after refresh/restart
- exposes a JSON API and WebSocket event stream
- includes unit, integration, browser E2E, and live validation paths

## Requirements

- Node 20+
- npm
- tmux installed for transports/features that require it
- agent CLIs installed as needed:
  - `codex`
  - `claude`
  - `opencode`

## Quick start

Install dependencies:

```bash
npm install
```

Initialize config and storage without auto-launching:

```bash
npx tsx src/cli/index.ts setup bootstrap --no-launch
```

Start the daemon:

```bash
npx tsx src/cli/index.ts daemon start
```

Check daemon status:

```bash
npx tsx src/cli/index.ts daemon status
```

Inspect adapter readiness:

```bash
npx tsx src/cli/index.ts agents list
```

Then open:

```text
http://127.0.0.1:4319
```

Stop the daemon:

```bash
npx tsx src/cli/index.ts daemon stop
```

## CLI commands

```text
npx tsx src/cli/index.ts setup bootstrap [--no-launch]
npx tsx src/cli/index.ts daemon <start|stop|restart|status>
npx tsx src/cli/index.ts agents <list|doctor>
npx tsx src/cli/index.ts sessions <list|attach|terminate> [id]
```

## Verification

Fast local verification:

```bash
npm run check
```

Browser E2E:

```bash
npm run test:e2e
```

Live validation per adapter:

```bash
npm run test:live -- --agent codex
npm run test:live -- --agent claude
npm run test:live -- --agent opencode
```

Live-test exit codes:

- `0`: success
- `1`: functional failure
- `2`: blocked by a documented prerequisite such as missing binary, missing auth, missing tmux, or insufficient vendor credit/quota

## Storage

By default, the app stores state under:

```text
~/.codex-everywhere/
```

You can override the storage root with:

```bash
CODEX_EVERYWHERE_ROOT=/path/to/root
```

If the daemon cannot find Codex from its runtime environment, you can also set:

```bash
CODEX_EVERYWHERE_CODEX_PATH=/absolute/path/to/codex
```

or persist the same value under `agents.codex.binaryPath` in the config file.

## Repo map

- `src/adapters/` — adapter implementations
- `src/core/` — runtime, auth, storage, doctor, reducer/session manager
- `src/server/` — Fastify app and API/WebSocket routes
- `src/ui/` — browser UI assets
- `src/cli/` — CLI entrypoint
- `test/` — unit, integration, E2E, and live tests
- `docs/` — authoritative spec and release contract

## Read the docs

Recommended order:

1. `docs/product-spec.md`
2. `docs/architecture.md`
3. `docs/agent-adapters.md`
4. `docs/api.md`
5. `docs/config-storage.md`
6. `docs/testing-and-live-validation.md`
7. `docs/production-readiness.md`
8. `docs/work-packages.md`

## Notes

- The project is single-user and local-first.
- The daemon binds to `127.0.0.1` by default.
- Non-loopback hosting requires password auth.
- Session working directories must exist on the same machine that is running the daemon.
- Plan mode is distinct from plan requests; see `docs/agent-adapters.md` and `docs/api.md`.
- For release readiness, prepared-environment live validation is still required even if a local machine reports a documented blocked condition.
