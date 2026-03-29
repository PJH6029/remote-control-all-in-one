# Product Specification

## 1. Product Summary

Remote Control All-in-One is a local web control plane for CLI coding agents. A single developer can launch and manage agent sessions from a browser, follow normalized live output, resolve approvals and questions, switch plan/build behavior, inspect runtime state, and recover after refresh or daemon restart.

The product must feel like a durable local workspace for long-running agent sessions, not a thin terminal wrapper.

## 2. Goals

- provide a browser-based control plane for local agent sessions
- support multiple agent backends behind one shared UX contract
- preserve truthful mode, policy, and capability reporting
- make pending approvals, questions, and plan decisions visible and actionable
- support reliable recovery after refresh, daemon restart, or adapter restart
- provide enough observability and automation for repeatable release validation

## 3. Non-Goals

- multi-user collaboration
- cloud-hosted orchestration as a v1 requirement
- stronger sandbox/security guarantees than the underlying agent/runtime provides
- a plugin marketplace beyond the built-in adapters

## 4. Target User

The target user is an individual developer running supported agents on their own machine who wants a persistent browser workspace instead of managing multiple raw terminal sessions.

## 5. Supported Environments

- primary: macOS and Linux
- Node runtime: `>=20`
- browser: current Chromium, Safari, and Firefox
- local prerequisites:
  - `node`
  - `npm`
  - `tmux` when a selected adapter transport requires it
  - at least one supported agent binary installed and authenticated for live use

## 6. Core Concepts

### 6.1 Session

A session is one managed conversation with one adapter in one working directory. A session owns:
- stable normalized session id
- adapter id
- working directory
- title
- mode
- execution policy
- normalized event stream
- pending action queue
- persisted snapshot and event history

### 6.2 Mode

Required modes:
- `build`
- `plan`

`plan` means analysis-first behavior with no write-like actions unless the user explicitly returns to build mode.
This is distinct from a plan request: a plan request is a pending action of type `plan`, not the session mode itself.

### 6.3 Execution Policy

Execution policy controls:
- filesystem access level
- network access level
- approval behavior
- extra writable roots when supported

### 6.4 Pending Action

A pending action is a structured UI/API decision that blocks forward progress until resolved.

Required types:
- approval
- question
- plan

### 6.5 Terminal Mirror

The terminal mirror is supplemental diagnostics. It is never the source of truth for approvals, questions, plan state, or transcript structure.

## 7. Required User Surfaces

### 7.1 Dashboard

Required capabilities:
- render a usable shell before slower readiness hydration completes
- list active and recent sessions
- create a new session
- search/filter by status, agent, directory, or title
- show adapter readiness and doctor warnings
- show connection state and daemon address

The new-session form must include:
- adapter selector
- working directory
- optional title
- initial prompt
- mode selector
- execution-policy preset or equivalent controls
- optional extra writable directories
- adapter-specific advanced options when supported

Session rows must show:
- title
- adapter display name
- status
- mode
- working directory
- last updated time
- pending-action indicator

### 7.2 Session Workspace

Required sections:
- transcript timeline
- composer
- session status bar
- pending-action queue
- metadata panel
- terminal/log mirror

Required controls:
- send message
- switch mode
- update execution policy
- resolve any supported approvals/questions/plans
- terminate
- force terminate when graceful terminate times out or fails
- open working directory when the platform/runtime can support it safely
- attach only when the adapter reports a supported attach capability

Required visible metadata:
- session id
- adapter id/display name
- cwd
- start/update timestamps
- current mode
- current execution policy
- capability flags
- runtime or connection status

Required transcript behavior:
- incremental assistant streaming
- clear separation between user messages, commentary, final answers, notices, terminal output, and errors
- stable rendering after refresh
- no duplicate events after reconnect
- readiness information may hydrate after the initial shell paint; the shell itself must not wait on full probe completion

### 7.3 Settings And Doctor

Required capabilities:
- edit bind host and port
- edit auth mode and related restart-required settings
- inspect storage paths
- inspect retention settings
- inspect installed agent binaries
- inspect adapter probe results and remediation text
- inspect tmux availability
- inspect per-adapter readiness when detectable

Doctor output must classify each check as:
- healthy
- warning
- blocked

### 7.4 CLI

Required command groups:
- `setup bootstrap`
- `daemon start`
- `daemon stop`
- `daemon restart`
- `daemon status`
- `agents list`
- `agents doctor`
- `sessions list`
- `sessions attach <id>` when supported
- `sessions terminate <id>`

The CLI must remain a thin control surface over the same runtime/storage model used by the browser.

## 8. End-To-End User Flows

### 8.1 First Run
1. user runs `setup bootstrap`
2. bootstrap verifies prerequisites and creates default config if missing
3. bootstrap records doctor output
4. bootstrap can launch the daemon unless disabled
5. browser reaches dashboard or password login screen depending on auth mode

Acceptance criteria:
- first-run guidance is concrete when prerequisites are missing
- the user does not need manual server wiring to reach the product

### 8.2 Create A Session
1. user opens the dashboard form
2. user chooses adapter, cwd, prompt, and mode
3. system returns a stable session id immediately
4. UI navigates to the workspace
5. normalized events begin streaming

Acceptance criteria:
- title is auto-derived when omitted
- initial adapter or startup failures are visible in the workspace and dashboard

### 8.3 Drive A Session
1. user sends a follow-up message
2. UI shows optimistic local state
3. backend records `user.sent` with client-idempotency semantics
4. adapter receives the message through its supported input path
5. UI receives normalized commentary/final output

Acceptance criteria:
- duplicate submissions are prevented or reconciled safely
- composer disablement reflects real adapter capability/state

### 8.4 Resolve Pending Actions
1. adapter emits a normalized approval/question/plan request
2. workspace shows a structured pending-action card
3. user resolves it through the UI
4. backend records a normalized resolution event
5. adapter resumes through its supported path

Acceptance criteria:
- pending actions do not rely on terminal scraping
- resolution survives refresh and replay
- surfaces must distinguish plan mode from plan requests

### 8.5 Switch Mode Or Policy
1. user changes mode or execution policy
2. backend applies the request through the adapter/runtime contract
3. if restart is required, the UI reports it explicitly
4. session id remains stable across the transition

Acceptance criteria:
- the current mode and policy are always visible
- restart-required transitions are truthful and recoverable

### 8.6 Recover After Refresh Or Restart
1. browser refreshes or daemon restarts
2. client reconnects with per-session replay cursors
3. backend rebuilds truth from snapshots + events + adapter reconciliation
4. transcript and pending state resume without duplication

Acceptance criteria:
- no transcript corruption
- pending actions remain actionable unless invalidated by a later event

### 8.7 Terminate Session
1. user requests terminate
2. backend attempts graceful shutdown
3. if timeout or failure occurs, force terminate becomes available when supported
4. session becomes `terminated` and remains visible in history

Acceptance criteria:
- termination result is persisted in the event log
- terminated sessions remain inspectable from history

## 9. UX Requirements

### 9.1 Visual Structure

- desktop-first layout with responsive fallback
- transcript readability takes priority over control density
- pending actions are visually prominent
- status and mode indicators use text plus color, never color alone

### 9.2 Accessibility

- keyboard-accessible controls and navigation
- visible focus states
- semantic buttons/forms/dialogs/status regions
- live regions for pending actions and status changes
- WCAG AA-aligned contrast for core text and controls

### 9.3 Responsiveness

- dashboard fully usable at `1280px` and above
- workspace usable at `768px` without hiding critical actions
- smaller layouts may collapse panels, but transcript, pending actions, and terminate controls must remain usable

### 9.4 Performance

- warm dashboard shell load under 2 seconds
- readiness hydration may continue after first paint
- session creation to first visible state under 2 seconds when the adapter is healthy
- reconnect to visible transcript under 2 seconds on a local machine
- responsive rendering with at least 10,000 persisted events in session history

## 10. Security Requirements

- default bind address is `127.0.0.1`
- non-loopback bind requires password auth
- state-changing requests require CSRF-safe browser auth handling
- secrets must not be shown in the UI, persisted logs, or doctor payloads
- capability and permission displays must be honest about real runtime limits

## 11. Product-Level Acceptance Criteria

- a user can bootstrap and reach the dashboard from local setup commands
- a user can create and operate sessions through one shared dashboard/workspace UX
- a user can inspect adapter readiness before session creation
- a user can complete approval, question, plan, mode/policy, recovery, and termination flows through the UI/API contract
- the application can be validated end to end through the automated and manual gates defined in `testing-and-live-validation.md`
- plan requests remain a distinct user-visible concept from plan mode in every surface
