# API Specification

## 1. API Shape

The daemon exposes:
- JSON over HTTP for control, snapshots, settings, and doctor data
- WebSocket for live event replay and subscription

Base URL examples:
- `http://127.0.0.1:4319`
- `http://localhost:4319`

All routes are rooted at `/api`.

## 2. Versioning

The initial API is unprefixed, but every response must include:
- `apiVersion`
- `serverTime`

Breaking changes require path versioning such as `/api/v2`.

## 3. Authentication

Required auth modes:
- `local-session`
- `password`

Rules:
- unauthenticated requests return `401`
- state-changing browser requests require CSRF validation
- the SPA must be able to discover auth state through dedicated auth routes

## 4. Common Response Envelope

Success:

```json
{
  "ok": true,
  "apiVersion": "1",
  "serverTime": "2026-03-29T10:00:00.000Z",
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "apiVersion": "1",
  "serverTime": "2026-03-29T10:00:00.000Z",
  "error": {
    "code": "session_not_found",
    "message": "Session was not found.",
    "details": {}
  }
}
```

## 5. Common Schemas

### 5.1 SessionSummary

```json
{
  "id": "ses_01H...",
  "title": "Refactor auth middleware",
  "agentId": "codex",
  "status": "running",
  "mode": "build",
  "cwd": "/workspace/app",
  "hasPendingActions": false,
  "createdAt": "2026-03-29T10:00:00.000Z",
  "updatedAt": "2026-03-29T10:01:00.000Z",
  "lastSequence": 42
}
```

### 5.2 SessionDetail

`SessionDetail` extends `SessionSummary` with:
- `executionPolicy`
- `capabilities` (including distinct flags for plan mode support versus structured plan-request support)
- `pendingActions`
- `adapterState` (server-owned, browser-safe subset only when needed)

### 5.3 SessionEvent

Required fields:
- `id`
- `sessionId`
- `sequence`
- `type`
- `createdAt`
- `source.adapterId`
- `data`

### 5.4 PendingAction

Required fields:
- `id`
- `sessionId`
- `type`
- `status`
- `prompt`
- `options`
- `defaultOptionId` when applicable
- `createdAt`
- optional `vendorPayload`

## 6. Idempotency Rules

### 6.1 Session Creation

`POST /api/sessions` must support `X-Idempotency-Key`.

If the same authenticated client repeats a create request with the same effective payload and idempotency key, the server must return the existing normalized session instead of creating a duplicate.

### 6.2 Session Messages

`POST /api/sessions/:id/messages` requires `clientMessageId`.

Duplicate client message ids for the same session must not create duplicate `user.sent` events.

## 7. HTTP Endpoints

### 7.0 Auth Endpoints

#### `GET /api/auth/session`
Returns current browser auth state.

#### `POST /api/auth/login`
Logs in for password mode.

#### `POST /api/auth/logout`
Clears the current authenticated browser session.

### 7.1 `GET /api/health`
Returns daemon readiness and basic runtime status.

### 7.2 `GET /api/agents`
Returns:
- adapter probe results
- capability metadata
- adapter option schema
- doctor summary when useful for the dashboard

The dashboard may fetch this data after first paint; the shell itself should not depend on every probe result completing before it becomes usable.
The server should avoid duplicate probe work across `/api/agents` and `/api/doctor` by reusing or caching the same readiness snapshot for a short interval.

### 7.3 `GET /api/sessions`
Returns active and recent sessions.

Query params:
- `status`
- `agentId`
- `limit`
- `cursor`
- `search`

Response data:

```json
{
  "items": [],
  "nextCursor": null
}
```

### 7.4 `POST /api/sessions`
Creates a session.

Required request fields:
- `agentId`
- `cwd`
- `initialPrompt`
- `mode`
- `executionPolicy`

Validation rules:
- `cwd` must exist on the machine running the daemon and must be a directory
- every `extraDirectories` entry must also exist and be a directory

Optional request fields:
- `title`
- `extraDirectories`
- `adapterOptions`

Response:
- full `SessionDetail`

### 7.5 `GET /api/sessions/:id`
Returns latest materialized session detail.

### 7.6 `GET /api/sessions/:id/events`
Returns ordered event history for one session.

Query params:
- `afterSequence` (exclusive)
- `limit`

Response data:

```json
{
  "items": [],
  "lastSequence": 42
}
```

### 7.7 `POST /api/sessions/:id/messages`
Sends user input into a session.

Request body:

```json
{
  "text": "Continue with the implementation.",
  "clientMessageId": "msg_01H..."
}
```

### 7.8 `POST /api/sessions/:id/mode`
Updates session mode.

Response data must include:
- `mode`
- `restartRequired`
- optional `reason`

`mode: plan` is session mode only. It does not itself create or resolve a plan request.

### 7.9 `POST /api/sessions/:id/policy`
Updates execution policy.

Response data must include:
- `executionPolicy`
- `restartRequired`
- optional `reason`

### 7.10 `POST /api/sessions/:id/pending/:pendingId/resolve`
Resolves an open pending action.

For approvals/plans:

```json
{
  "resolution": {
    "optionId": "allow"
  }
}
```

For questions:

```json
{
  "resolution": {
    "optionId": "submit",
    "text": "Use the existing helper instead of creating a new file."
  }
}
```

Plan requests are resolved here when the pending action type is `plan`. This is distinct from the mode endpoint above: a session may be in build mode while a plan request is open, or in plan mode without a plan request.

### 7.11 `POST /api/sessions/:id/terminate`
Requests graceful or forced termination.

Request body:

```json
{
  "force": false
}
```

### 7.12 `GET /api/settings`
Returns browser-safe daemon settings.

### 7.13 `PUT /api/settings`
Updates mutable settings and returns:
- updated browser-safe settings
- `restartRequired`
- `reasons` (list of changed fields that require restart)

### 7.14 `GET /api/doctor`
Returns full doctor report.

The browser may fetch this lazily after first paint or when the doctor surface is opened, as long as the latest cached readiness state remains truthful.

## 8. WebSocket Contract

Endpoint:
- `WS /api/events`

The websocket is global and replay-aware.

### 8.1 Client Subscribe Message

```json
{
  "type": "subscribe",
  "sessionIds": ["ses_01H..."],
  "after": {
    "ses_01H...": 42
  }
}
```

If `sessionIds` is omitted, the server may stream all authorized sessions.

### 8.2 Server Messages

Event message:

```json
{
  "type": "event",
  "event": {}
}
```

Snapshot message:

```json
{
  "type": "session.snapshot",
  "session": {}
}
```

Heartbeat message:

```json
{
  "type": "heartbeat",
  "serverTime": "2026-03-29T10:01:00.000Z"
}
```

Error message:

```json
{
  "type": "error",
  "code": "invalid_subscription",
  "message": "Requested session is not available."
}
```

### 8.3 Replay Rules

- replay is driven by persisted per-session sequences
- replay uses the same reducer/materializer truth as HTTP session detail
- servers must not emit duplicate events for the same event id during reconnect
- clients may receive a snapshot before replay events for that session

## 9. Required Event Types

Required public event types:
- `session.started`
- `session.updated`
- `assistant.delta`
- `assistant.final`
- `user.sent`
- `approval.requested`
- `approval.resolved`
- `question.requested`
- `question.resolved`
- `plan.requested`
- `plan.resolved`
- `terminal.output`
- `session.terminated`
- `session.error`

## 10. Error Codes

Required error codes:
- `unauthorized`
- `forbidden`
- `invalid_request`
- `validation_failed`
- `session_not_found`
- `pending_action_not_found`
- `adapter_not_available`
- `adapter_blocked`
- `conflict`
- `internal_error`

## 11. Compatibility Rules

- new optional fields may be added without a version bump
- required fields may not disappear or change meaning without a version bump
- new event types are append-only in v1
- capability-gated affordances may be omitted or disabled when the adapter truthfully reports lack of support
