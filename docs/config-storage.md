# Configuration And Storage Specification

## 1. Storage Root

The application stores durable state under:
- `~/.codex-everywhere/`

Required layout:

```text
~/.codex-everywhere/
  config.json
  state/
    doctor.json
    active-sessions.json
    session-events/
      <sessionId>.jsonl
    session-snapshots/
      <sessionId>.json
    adapter/
      <adapterId>/
        <sessionId>/
  logs/
    daemon.log
    adapter-probe.log
    sessions/
      <sessionId>.log
  runtime/
    daemon.pid
    daemon-url.txt
  tmp/
    <sessionId>/
```

## 2. Configuration File

Main config path:
- `~/.codex-everywhere/config.json`

The config file is the durable source of truth for settings. Environment overrides may affect runtime behavior but must not silently rewrite the saved config.

## 3. Config Shape

The config must support these top-level sections:
- `server`
- `agents`
- `sessions`
- `ui`
- `retention`

Required fields:
- `server.host`
- `server.port`
- `server.openBrowser`
- `server.authMode`
- `server.passwordHash`
- `agents.defaultAgentId`
- per-adapter config buckets for `codex`, `claude`, and `opencode`
- `sessions.defaultMode`
- `sessions.defaultExecutionPolicy`
- `sessions.titleStrategy`
- `sessions.autoRecovery`
- `ui.showTerminalMirrorByDefault`
- `ui.eventPageSize`
- `retention.maxRecentSessions`
- `retention.pruneTerminalLogsAfterDays`
- `retention.pruneEventsAfterDays`

## 4. Environment Overrides

Environment overrides are optional and may support keys such as:
- `CODEX_EVERYWHERE_HOST`
- `CODEX_EVERYWHERE_PORT`
- `CODEX_EVERYWHERE_OPEN_BROWSER`
- `CODEX_EVERYWHERE_AUTH_MODE`
- `CODEX_EVERYWHERE_CODEX_PATH`

Rules:
- config file remains the durable source of truth
- env-provided secrets are not persisted unless explicitly requested
- runtime validation still applies after overrides are merged
- agent-specific config buckets may include a `binaryPath` override when the daemon environment cannot resolve a CLI from `PATH`

## 5. Settings Mutability

Runtime-updatable settings may include:
- host
- port
- auth mode
- retention
- UI preferences

The settings API must report:
- the updated safe settings payload
- whether restart is required
- which changed fields triggered restart requirements

## 6. Session Snapshot

Each active or retained session must have a latest materialized snapshot.

Required fields include:
- normalized id
- title
- agent id
- status
- mode
- cwd
- execution policy
- pending actions
- last sequence
- created/updated timestamps
- adapter-owned opaque state

Rules:
- snapshot updates must be atomic
- snapshot must be reconstructible from replay if lost
- browser-facing APIs may redact or omit adapter-owned opaque fields when needed

## 7. Session Event Log

Each session has an append-only JSONL event log.

Rules:
- events are written in ascending sequence order
- events are never edited in place
- replay must tolerate trailing partial lines after crash and ignore them safely
- events remain the highest-priority source for replay truth

## 8. Active Session Index

`state/active-sessions.json` is an optimization for startup and dashboard rendering.

Rules:
- it is not the ultimate source of truth
- if missing or stale, it must be rebuilt from snapshots/events
- terminated sessions may be excluded from the active index while still remaining retained elsewhere

## 9. Adapter State And Temp Namespaces

Each adapter may persist opaque adapter-owned state under:
- `state/adapter/<adapterId>/<sessionId>/`

Temporary per-session artifacts live under:
- `tmp/<sessionId>/`

Temp artifacts may include:
- generated config files
- hook files
- wrapper scripts
- local sockets or pid markers

Rules:
- each session gets its own temp namespace
- stale temp files must not block recovery
- cleanup should run on terminate, but recovery must tolerate leftovers safely

## 10. Log Files

Required persisted logs:
- `logs/daemon.log`
- `logs/adapter-probe.log`
- `logs/sessions/<sessionId>.log`

Daemon log should include:
- startup/shutdown
- bind info
- doctor summary
- unhandled runtime errors
- pruning activity

Session log should include:
- adapter lifecycle
- policy/mode changes
- recovery actions
- termination flow
- notable adapter/runtime errors

## 11. Secrets Handling

Possible secret-like data includes:
- local auth secret or session token material
- password hash
- adapter-specific tokens or auth hints
- generated config fragments containing credentials

Rules:
- passwords are stored only as hashes
- secrets must be redacted from logs, doctor payloads, API responses, and saved diagnostics
- temporary secret-bearing files must be isolated and cleaned up when safe

## 12. Retention And Pruning

Required retention behavior:
- keep recent session snapshots after termination
- prune terminal mirror logs earlier than normalized events when configured
- never prune active sessions
- retain at least the latest snapshot for each retained session
- log pruning actions visibly

Pruning must not remove data still required for:
- replay of retained UI history
- release evidence or live-test assertions within the retention window

## 13. Recovery Rules

On startup the runtime must:
- validate config
- load snapshots and active-session index
- rebuild or validate session summaries through the reducer/materializer
- reconcile non-terminated sessions with adapters
- rebuild replay truth from persisted sequences, not browser memory

Precedence rules:
- event log wins over snapshot for sequence and pending-action truth
- snapshot wins over active-session index for summary fields
- adapter reconciliation may append new events, but must not silently mutate prior persisted history

## 14. Validation Requirements

All config and storage reads must use runtime validation.

Required validation targets:
- config file
- snapshot files
- event lines
- active-session index
- pending action payloads
- adapter option payloads

Validation failures must be explicit, diagnosable, and recoverable where possible.

## 15. Release Evidence And Repo-Local Artifacts

Release evidence does not live in the daemon storage root. Use a repo-local evidence bundle under `.omx/validation/` for release notes, manual-checklist records, and preserved verification summaries unless a later release document says otherwise.

Rules:
- `.omx/validation/` is the default location for reproducible release evidence
- Playwright traces/screenshots under `test-results/` are transient test artifacts, not durable product state
- release evidence must be separate from runtime state under `~/.codex-everywhere/`
- evidence records must be reproducible from the verified commands that produced them
