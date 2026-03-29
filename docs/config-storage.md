# Configuration And Storage Specification

## 1. Storage Root

The application stores its state under:

- `~/.codex-everywhere/`

Required subpaths:

```text
~/.codex-everywhere/
  config.json
  state/
    active-sessions.json
    session-events/
      <sessionId>.jsonl
    session-snapshots/
      <sessionId>.json
    adapter/
      <adapterId>/
  logs/
    daemon.log
    sessions/
      <sessionId>.log
  runtime/
    daemon.pid
    daemon-url.txt
  tmp/
```

## 2. Configuration File

Main config path:

- `~/.codex-everywhere/config.json`

Secrets may be stored in this file only when no safer store is available, but they must be isolated under clear keys and never echoed in logs or browser responses.

## 3. Config Shape

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 4319,
    "openBrowser": true,
    "authMode": "local-session",
    "passwordHash": null
  },
  "agents": {
    "defaultAgentId": "codex",
    "codex": {},
    "claude": {},
    "opencode": {}
  },
  "sessions": {
    "defaultMode": "build",
    "defaultExecutionPolicy": {
      "filesystem": "workspace-write",
      "network": "on",
      "approvals": "on-request",
      "writableRoots": []
    },
    "titleStrategy": "from-initial-prompt",
    "autoRecovery": true
  },
  "ui": {
    "showTerminalMirrorByDefault": true,
    "eventPageSize": 200
  },
  "retention": {
    "maxRecentSessions": 200,
    "pruneTerminalLogsAfterDays": 30,
    "pruneEventsAfterDays": 90
  }
}
```

## 4. Environment Overrides

The implementation may support environment overrides, but they must obey:

- environment overrides are optional
- config file remains the durable source of truth
- secrets from environment must not be persisted unless explicitly requested

Recommended overrides:

- `CODEX_EVERYWHERE_HOST`
- `CODEX_EVERYWHERE_PORT`
- `CODEX_EVERYWHERE_OPEN_BROWSER`
- `CODEX_EVERYWHERE_AUTH_MODE`

## 5. Settings Mutability

Runtime-updatable settings:

- host
- port
- auth mode
- retention
- UI preferences

Settings that may require daemon restart must return:

- whether restart is required
- what setting triggered it

## 6. Session Snapshot

Each active or retained session must have a materialized snapshot file:

```json
{
  "id": "ses_01H...",
  "title": "Refactor auth middleware",
  "agentId": "codex",
  "status": "idle",
  "mode": "build",
  "cwd": "/workspace/app",
  "executionPolicy": {},
  "pendingActions": [],
  "lastSequence": 42,
  "createdAt": "2026-03-29T10:00:00.000Z",
  "updatedAt": "2026-03-29T10:01:00.000Z",
  "adapterState": {
    "vendorSessionId": "opaque"
  }
}
```

Rules:

- `adapterState` is opaque outside the adapter
- snapshot updates must be atomic
- snapshot must be reconstructible from event replay if lost

## 7. Session Event Log

Each session has an append-only JSONL file:

- `state/session-events/<sessionId>.jsonl`

Each line must be one `SessionEvent`.

Rules:

- events are written in ascending sequence order
- events are never edited in place
- event replay must tolerate trailing partial lines after crash and ignore them safely

## 8. Active Session Index

`state/active-sessions.json` contains lightweight metadata for quick startup:

```json
{
  "items": [
    {
      "id": "ses_01H...",
      "status": "running",
      "agentId": "codex",
      "updatedAt": "2026-03-29T10:01:00.000Z"
    }
  ]
}
```

Rules:

- this is an optimization, not the ultimate source of truth
- if the file is missing or stale, rebuild it from snapshots

## 9. Log Files

Required logs:

- `logs/daemon.log`
- `logs/sessions/<sessionId>.log`

Daemon log should include:

- startup
- shutdown
- bind info
- doctor results
- unhandled errors

Session log should include:

- adapter lifecycle
- terminal mirror summary
- policy changes
- mode changes
- terminate flow

## 10. Secrets Handling

The system may hold:

- local auth secret
- optional password hash
- adapter-specific tokens or paths if needed

Rules:

- store password as a hash, never plaintext
- redact secrets from browser responses
- redact secrets from structured logs
- adapter-owned temporary files containing secrets must live under `tmp/` or adapter storage and be deleted when no longer needed

## 11. Temporary Files

Temporary per-session artifacts may include:

- generated config files
- generated hook files
- generated shell wrappers
- temporary sockets or pid markers

Rules:

- each session gets its own temp namespace
- temp files must be safe to recreate
- cleanup should happen on terminate, but stale temp files must not block recovery

## 12. Retention And Pruning

Required retention behaviors:

- keep recent session snapshots even after termination
- prune terminal logs sooner than normalized events
- do not prune active sessions
- pruning must be explicit and observable in logs

Pruning must not remove:

- the latest snapshot of a retained session
- normalized events still needed for recent UI history or live-test assertions

## 13. Recovery Rules

On startup:

- validate config
- load active session index if present
- load snapshots
- reconcile sessions with adapters
- recover WebSocket cursors from event sequences only, not from browser memory

If files disagree:

- event log wins over snapshot for sequence and pending-action truth
- snapshot wins over active-session index for summary fields

## 14. Validation Requirements

All config and storage reads must use runtime validation.

Required validation targets:

- config file
- snapshot file
- event line shape
- pending action payload
- adapter option payloads

Validation failures must be explicit and recoverable where possible.
