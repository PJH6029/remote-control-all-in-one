# Product Specification

## 1. Product Summary

The product is a local web control plane for CLI coding agents. It lets a single developer launch and manage agent sessions from a browser, stream agent output live, answer approvals and questions, switch between build and plan behavior, inspect terminal activity, and recover sessions after refresh or daemon restart.

The product must feel like a dedicated workspace for long-running local agent sessions, not a thin terminal wrapper.

## 2. Goals

- Provide a browser-based UI for creating and managing local agent sessions.
- Support multiple agent backends through a shared user experience.
- Preserve agent-specific strengths while exposing a normalized product surface.
- Make approvals, user questions, and plan/build mode visible and controllable through the UI.
- Support reliable recovery after browser refresh, daemon restart, or agent process restart.
- Provide enough observability and testability for unattended automated validation.

## 3. Non-Goals

- Multi-user collaboration or shared remote workspaces.
- Cloud-hosted orchestration as a v1 requirement.
- Sandboxing beyond what the underlying agent already supports.
- A generic plugin marketplace in v1.
- Replacing the native UI of each agent for every advanced vendor-specific feature.

## 4. Target User

The target user is an individual developer running agents on their own machine who wants a persistent browser workspace instead of driving each agent directly through its own terminal UI.

## 5. Supported Environments

- Primary: macOS and Linux
- Node runtime: `>=20`
- Browser: recent Chromium, Safari, and Firefox
- Required local dependencies:
  - `node`
  - `npm`
  - `tmux`
  - at least one supported agent binary installed and authenticated

Windows support may be added later, but is out of scope for the initial done criteria unless explicitly implemented.

## 6. Core Concepts

### 6.1 Session

A session is one managed conversation with one selected adapter in one working directory. A session owns:

- a stable session id
- an agent id
- a working directory
- a title
- a mode
- an execution policy
- a normalized event stream
- zero or more pending actions
- persisted summary state

### 6.2 Mode

Two modes are required:

- `build`
  - the agent is allowed to perform implementation work within the configured execution policy
- `plan`
  - the agent is constrained to analysis, inspection, and proposal behavior

When a vendor has a built-in plan mode, the adapter must use it. When the vendor does not, the adapter must emulate plan mode with a read-only or equivalent constrained execution policy plus explicit plan-mode instructions.

### 6.3 Execution Policy

Execution policy is the normalized control over what the agent may do locally. It includes:

- filesystem access level
- network access level
- approval behavior
- extra writable directories if supported

### 6.4 Pending Action

A pending action is a user-facing decision or answer required before the session can proceed. Types include:

- approval request
- question request
- plan confirmation

### 6.5 Terminal Mirror

The terminal mirror is a supplemental view of raw stdout and stderr. It is useful for debugging, but it is not the source of truth for UI state. The source of truth is the normalized event stream.

## 7. Required User Surfaces

## 7.1 Dashboard

The dashboard is the landing page after the daemon starts.

Required capabilities:

- list active and recent sessions
- create a new session
- search and filter sessions by status, agent, directory, or title
- show adapter readiness and doctor warnings
- show daemon URL and connection state

The new session form must include:

- agent selector
- working directory
- optional title
- initial prompt
- mode selector
- autonomy or execution preset
- optional extra writable directories
- adapter-specific advanced options rendered from adapter schema

Dashboard session rows must show:

- title
- agent display name
- status
- mode
- working directory
- last updated time
- whether pending actions exist

## 7.2 Session Workspace

The session workspace is the primary collaboration surface.

Required panes or sections:

- transcript timeline
- composer for sending user input
- status bar
- pending action queue
- terminal/log mirror
- session metadata panel

Required controls:

- send message
- switch mode
- update execution policy
- approve or deny pending approvals
- answer pending questions
- accept or defer plan transitions
- restart session
- terminate session
- force terminate session
- open working directory
- attach in `tmux` when supported

Required transcript behavior:

- incremental assistant streaming
- clear separation between user messages, commentary, final answers, system notices, and errors
- stable rendering after refresh
- no duplicate events after reconnect

Required metadata behavior:

- session id
- adapter id
- cwd
- start time
- current mode
- current execution policy
- capability flags
- underlying process or server connection status

## 7.3 Settings And Doctor

The settings and doctor area is the operational surface for configuration and troubleshooting.

Required capabilities:

- edit daemon bind address and port
- configure authentication mode
- inspect configured storage paths
- inspect retention settings
- inspect installed agent binaries
- inspect adapter probe results
- inspect `tmux` availability
- inspect per-adapter authentication readiness when detectable
- render adapter-specific setup guidance

Doctor output must clearly distinguish:

- healthy
- warning
- blocked

## 7.4 CLI

The CLI is required even though the browser is the primary UI.

Required command groups:

- `setup bootstrap`
- `daemon start`
- `daemon stop`
- `daemon restart`
- `daemon status`
- `agents list`
- `agents doctor`
- `sessions list`
- `sessions attach <id>`
- `sessions terminate <id>`

The CLI must be thin enough that browser actions and CLI actions operate on the same underlying runtime model and storage.

## 8. End-To-End User Flows

## 8.1 First Run

1. User runs `setup bootstrap`.
2. Bootstrap verifies prerequisites and creates default config if missing.
3. Bootstrap probes installed agents and stores doctor results.
4. Bootstrap starts the daemon unless `--no-launch` is provided.
5. The daemon opens the browser to the dashboard.
6. If no authentication is configured yet, the daemon establishes a local authenticated session using an ephemeral cookie or token.

If password auth is enabled instead, the browser must land on a login screen before showing the dashboard.

Acceptance criteria:

- the user can reach the dashboard without manual server setup
- missing prerequisites are surfaced with concrete remediation text

## 8.2 Create A Session

1. User opens the dashboard form.
2. User selects adapter and working directory.
3. User optionally enters title and advanced options.
4. User submits the form.
5. The UI navigates directly to the session workspace.
6. The session starts streaming normalized events.

Acceptance criteria:

- a created session receives a stable id immediately
- title is auto-derived from the initial prompt when omitted
- initial errors are visible in the workspace and in the dashboard row

## 8.3 Drive A Session

1. User sends a follow-up message from the composer.
2. The workspace shows the message instantly as optimistic local state.
3. The backend appends `user.sent`.
4. The adapter forwards the input.
5. The UI streams `assistant.delta` and `assistant.final`.

Acceptance criteria:

- the composer disables only when the adapter explicitly cannot accept input
- duplicate submissions are prevented with idempotency keys

## 8.4 Handle A Pending Approval

1. The adapter emits `approval.requested`.
2. The session status changes to `waiting_approval`.
3. The UI surfaces the approval prompt and options.
4. User approves or denies.
5. The backend appends `approval.resolved`.
6. The adapter receives the resolution and resumes.

Acceptance criteria:

- the pending approval appears without reading raw terminal text
- resolution survives browser refresh

## 8.5 Handle A Pending Question

1. The adapter emits `question.requested`.
2. The workspace shows a focused question card.
3. The user answers from the UI.
4. The backend appends `question.resolved`.
5. The adapter injects the answer through its official input path.

Acceptance criteria:

- the answer path is structured and adapter-owned
- the UI does not emulate keystrokes into a terminal

## 8.6 Switch Mode

1. User changes from `build` to `plan` or back.
2. The backend calls the adapter mode update path.
3. If the adapter can update in place, it does so.
4. If the adapter must restart, the session id stays the same and the UI shows a temporary restart state.

Acceptance criteria:

- session history stays intact across mode changes
- the current mode is always visible

## 8.7 Recover After Refresh Or Restart

1. User refreshes the browser or the daemon restarts.
2. The UI reconnects through WebSocket and requests current session detail.
3. The backend rebuilds in-memory state from snapshots plus append-only events.
4. Streaming resumes from the last known sequence.

Acceptance criteria:

- no transcript corruption
- no event duplication in the rendered timeline
- pending actions remain actionable

## 8.8 Terminate Session

1. User clicks terminate.
2. UI asks for confirmation.
3. Backend attempts graceful shutdown through the adapter.
4. If timeout expires, user may issue force terminate.
5. Session becomes `terminated`.

Acceptance criteria:

- terminated sessions stay visible in history
- termination result is recorded in the event log

## 9. UX Requirements

### 9.1 Visual Structure

- Desktop-first layout with responsive mobile fallback.
- The workspace must prioritize transcript readability over dense controls.
- Pending actions must be visually prominent.
- Use clear mode and status labels with color plus text, not color alone.

### 9.2 Accessibility

- Keyboard-accessible navigation for all controls.
- Visible focus states.
- Semantic buttons, forms, dialogs, and status regions.
- Live region announcements for pending actions and session status changes.
- Minimum contrast ratio aligned with WCAG AA for core text and controls.

### 9.3 Responsiveness

- Dashboard usable at `1280px` and above with full side panels.
- Workspace usable at `768px` without hidden critical actions.
- Mobile may collapse panels, but must still support reading transcript, resolving pending actions, and terminating sessions.

### 9.4 Performance

- initial dashboard load under 2 seconds on a warm local daemon
- workspace event rendering must remain responsive with at least 10,000 persisted events in history
- reconnect after browser refresh should restore the visible transcript within 2 seconds on a local machine

## 10. Security Requirements

- Default bind address is `127.0.0.1`.
- Default auth mode is local session auth using an ephemeral secret or cookie.
- Non-loopback bind requires explicit password configuration.
- Secrets must never be echoed into the UI or event log.
- Per-session environment variables must be redacted in logs and doctor views.

## 11. Required Product-Level Acceptance Criteria

- A user can start the daemon and create a session entirely from local setup commands plus browser UI.
- A user can use all supported adapters through one shared dashboard and workspace.
- A user can inspect adapter readiness before starting a session.
- A user can recover from browser refresh, daemon restart, and adapter restart without losing normalized state.
- A user can complete at least one approval flow, one question flow, one plan flow, and one termination flow through the web UI.
- The application can be validated end to end through automated live tests defined in [testing-and-live-validation.md](./testing-and-live-validation.md).
