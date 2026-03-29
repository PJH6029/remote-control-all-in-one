# API Specification

## 1. API Shape

The daemon exposes:

- JSON over HTTP for control and snapshots
- WebSocket for live events

Base URL examples:

- `http://127.0.0.1:4319`
- `http://localhost:4319`

All routes are rooted at `/api`.

## 2. Versioning

The initial version is unprefixed, but all responses must include:

- `apiVersion`
- `serverTime`

If a future breaking version is added, it must use path versioning such as `/api/v2`.

## 3. Authentication

Required auth modes:

- `local-session`
  - daemon-managed local auth cookie or bearer token
- `password`
  - explicit password-based login for non-loopback hosting

Unauthenticated requests must return `401`.

The browser SPA must be able to determine auth state through dedicated auth routes.

## 4. Common Response Envelope

Success responses:

```json
{
  "ok": true,
  "apiVersion": "1",
  "serverTime": "2026-03-29T10:00:00.000Z",
  "data": {}
}
```

Error responses:

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

## 5.1 `SessionSummary`

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

## 5.2 `SessionDetail`

```json
{
  "id": "ses_01H...",
  "title": "Refactor auth middleware",
  "agentId": "codex",
  "status": "running",
  "mode": "build",
  "cwd": "/workspace/app",
  "executionPolicy": {
    "filesystem": "workspace-write",
    "network": "on",
    "approvals": "on-request",
    "writableRoots": ["/workspace/app"]
  },
  "capabilities": {
    "agentId": "codex",
    "displayName": "Codex",
    "transport": "pty",
    "supportsPlanMode": true,
    "supportsModeSwitch": true,
    "supportsExecutionPolicySwitch": true,
    "supportsPendingApprovals": true,
    "supportsQuestions": true,
    "supportsTmuxAttach": true,
    "supportsStructuredEvents": true,
    "supportsResume": true,
    "supportsForceTerminate": true,
    "supportsLocalBrowserOpen": false,
    "planModeImplementation": "native",
    "executionPolicyImplementation": "native"
  },
  "pendingActions": [],
  "lastSequence": 42,
  "createdAt": "2026-03-29T10:00:00.000Z",
  "updatedAt": "2026-03-29T10:01:00.000Z"
}
```

## 5.3 `SessionEvent`

```json
{
  "id": "evt_01H...",
  "sessionId": "ses_01H...",
  "sequence": 42,
  "type": "assistant.final",
  "createdAt": "2026-03-29T10:01:00.000Z",
  "source": {
    "adapterId": "codex",
    "vendorEventType": "turn.completed"
  },
  "data": {
    "channel": "final",
    "text": "Implemented the change and updated tests."
  }
}
```

## 5.4 `PendingAction`

```json
{
  "id": "pa_01H...",
  "sessionId": "ses_01H...",
  "type": "approval",
  "status": "open",
  "prompt": "Allow writing files in /workspace/app?",
  "options": [
    { "id": "allow", "label": "Allow", "kind": "allow" },
    { "id": "deny", "label": "Deny", "kind": "deny" }
  ],
  "createdAt": "2026-03-29T10:00:30.000Z",
  "vendorPayload": {
    "tool": "write_file"
  }
}
```

## 6. HTTP Endpoints

## 6.0 Auth Endpoints

### `GET /api/auth/session`

Returns current auth state for the browser client.

Response data:

```json
{
  "authenticated": true,
  "mode": "local-session"
}
```

### `POST /api/auth/login`

Required for `password` mode and optional for future token exchange flows.

Request body:

```json
{
  "password": "example"
}
```

Success behavior:

- server issues an authenticated cookie or session token
- response returns current auth state

### `POST /api/auth/logout`

Clears the current authenticated session.

## 6.1 `GET /api/health`

Returns daemon readiness and basic environment health.

Response data:

```json
{
  "status": "ok",
  "daemon": {
    "pid": 12345,
    "bind": "127.0.0.1:4319",
    "uptimeSeconds": 121
  }
}
```

## 6.2 `GET /api/agents`

Returns installed adapters, capabilities, schemas, and doctor status.

Response data:

```json
{
  "agents": [
    {
      "probe": {},
      "capabilities": {},
      "optionSchema": {}
    }
  ]
}
```

## 6.3 `GET /api/sessions`

Returns active and recent sessions.

Query params:

- `status`
- `agentId`
- `limit`
- `cursor`

Response data:

```json
{
  "items": [],
  "nextCursor": null
}
```

## 6.4 `POST /api/sessions`

Creates a session.

Request body:

```json
{
  "agentId": "codex",
  "cwd": "/workspace/app",
  "title": "",
  "initialPrompt": "Inspect the repository and propose a refactor plan.",
  "mode": "plan",
  "executionPolicy": {
    "filesystem": "read-only",
    "network": "off",
    "approvals": "on-request",
    "writableRoots": []
  },
  "extraDirectories": [],
  "adapterOptions": {}
}
```

Rules:

- if `title` is empty, the backend must derive a title
- the endpoint should support `X-Idempotency-Key`
- the response must return a full `SessionDetail`

## 6.5 `GET /api/sessions/:id`

Returns the latest materialized session detail.

## 6.6 `GET /api/sessions/:id/events`

Returns event history for one session.

Query params:

- `afterSequence`
- `limit`

Response data:

```json
{
  "items": [],
  "lastSequence": 42
}
```

Rules:

- items must be ordered by ascending sequence
- `afterSequence` is exclusive

## 6.7 `POST /api/sessions/:id/messages`

Sends user input into a session.

Request body:

```json
{
  "text": "Continue with the implementation.",
  "clientMessageId": "msg_01H..."
}
```

Rules:

- `clientMessageId` is required for idempotency
- optimistic UI updates must reconcile with the resulting `user.sent` event

## 6.8 `POST /api/sessions/:id/mode`

Updates session mode.

Request body:

```json
{
  "mode": "build"
}
```

Response data:

```json
{
  "mode": "build",
  "restartRequired": false
}
```

## 6.9 `POST /api/sessions/:id/policy`

Updates execution policy.

Request body:

```json
{
  "executionPolicy": {
    "filesystem": "workspace-write",
    "network": "on",
    "approvals": "on-request",
    "writableRoots": ["/workspace/app", "/workspace/shared"]
  }
}
```

Response data:

```json
{
  "executionPolicy": {},
  "restartRequired": true
}
```

## 6.10 `POST /api/sessions/:id/pending/:pendingId/resolve`

Resolves an open pending action.

Request body for approval or plan:

```json
{
  "resolution": {
    "optionId": "allow"
  }
}
```

Request body for question:

```json
{
  "resolution": {
    "optionId": "submit",
    "text": "Use the existing helper instead of creating a new file."
  }
}
```

## 6.11 `POST /api/sessions/:id/terminate`

Terminates a session.

Request body:

```json
{
  "force": false
}
```

Response data:

```json
{
  "accepted": true
}
```

## 6.12 `GET /api/settings`

Returns daemon configuration safe for browser display.

Secrets must be redacted or omitted.

## 6.13 `PUT /api/settings`

Updates mutable settings.

Mutable examples:

- bind host
- port
- auth mode
- retention
- UI preferences

Immutable or protected settings must reject writes with `400` or `403`.

## 6.14 `GET /api/doctor`

Returns full runtime doctor report.

Response data:

```json
{
  "status": "warning",
  "checks": [
    {
      "id": "tmux",
      "status": "healthy",
      "summary": "tmux is installed."
    }
  ],
  "agents": []
}
```

## 7. WebSocket Contract

Endpoint:

- `WS /api/events`

The WebSocket is global, not per session. Clients may filter locally or subscribe to a subset after connect.

## 7.1 Client Hello

Client may send:

```json
{
  "type": "subscribe",
  "sessionIds": ["ses_01H..."],
  "after": {
    "ses_01H...": 42
  }
}
```

If omitted, the server may stream all authorized session events.

## 7.2 Server Messages

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

## 8. Event Type Payloads

`assistant.delta`

```json
{
  "channel": "commentary",
  "textDelta": "Inspecting the auth flow now."
}
```

`assistant.final`

```json
{
  "channel": "final",
  "text": "Updated the middleware and added tests."
}
```

`approval.requested`

```json
{
  "pendingAction": {}
}
```

`question.requested`

```json
{
  "pendingAction": {}
}
```

`plan.requested`

```json
{
  "pendingAction": {},
  "planPreview": "1. Update parser. 2. Add tests. 3. Validate CLI behavior."
}
```

`terminal.output`

```json
{
  "stream": "stdout",
  "chunk": "Running npm test\n"
}
```

`session.error`

```json
{
  "code": "adapter_launch_failed",
  "message": "Agent process exited before session initialization.",
  "recoverable": true,
  "actionHint": "Review doctor output and retry."
}
```

## 9. Error Codes

Required API error codes:

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

## 10. Compatibility Rules

- new optional response fields may be added without version bump
- existing fields may not change meaning without version bump
- event types are append-only in v1
- event payloads may gain optional fields, but required fields may not disappear
