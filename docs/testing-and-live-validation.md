# Testing And Live Validation Specification

## 1. Purpose

The test strategy must prove:

- the normalized core behaves correctly without vendor binaries
- each adapter integration is correct against its official surface
- the browser UI works end to end
- the product can be live-tested against real installed agents

## 2. Required Test Layers

- unit tests
- integration tests
- browser E2E tests
- live tests

## 3. Required Package Scripts

At minimum, the implementation must expose:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `npm run test:int`
- `npm run test:e2e`
- `npm run test:live`
- `npm run check`

`npm run check` must aggregate the fast non-live validations that are appropriate for CI and local development.

## 4. Unit Tests

Unit tests must cover:

- config parsing and validation
- execution policy normalization
- session reducer or materializer logic
- event sequence assignment
- pending action reducers
- API request validation
- adapter option schema validation
- CLI argument parsing
- doctor summary formatting

Required edge cases:

- duplicate client message ids
- stale pending action resolution
- invalid mode transitions
- snapshot rebuild from events
- secret redaction

## 5. Integration Tests

Integration tests must run against fake adapters and real storage.

A fake adapter framework is required. It must be able to simulate:

- delayed streaming
- approval requests
- question requests
- plan requests
- restart-required mode change
- graceful termination
- crash on startup
- crash during run

Required integration scenarios:

- create session and receive first events
- send message and stream commentary plus final output
- resolve approval allow
- resolve approval deny
- resolve question with freeform answer
- resolve plan with `accept`
- resolve plan with `stay_in_plan`
- switch mode with no restart
- switch mode with restart
- update execution policy
- terminate gracefully
- force terminate after timeout
- browser refresh style replay from `afterSequence`
- daemon restart style recovery from snapshot plus event log

## 6. Browser E2E Tests

Browser E2E tests must use Playwright.

Required scenarios:

- first-run onboarding or bootstrap handoff page
- dashboard render with doctor information
- create session from dashboard
- workspace transcript streaming
- pending approval resolution in UI
- pending question answer in UI
- mode toggle in UI
- terminate from UI
- settings edit and persistence
- reconnect after backend restart

Required browser assertions:

- optimistic user message appears and reconciles
- no duplicate transcript entries after reconnect
- pending action cards disappear after resolution
- disabled actions match capability flags

## 7. Live Tests

Live tests run against real installed agents and must use the public API, not private internals.

Required entry points:

- `npm run test:live -- --agent codex`
- `npm run test:live -- --agent claude`
- `npm run test:live -- --agent opencode`

## 7.1 Live Test Exit Codes

- `0` success
- `1` functional failure
- `2` blocked by missing binary, missing auth, or missing local prerequisite

Blocked must not be reported as success.

## 7.2 Live Test Prerequisite Checks

Each live test must verify before starting:

- agent binary present on `PATH`
- adapter probe status not blocked
- `tmux` present if the selected adapter transport requires it
- required local auth exists when detectable

## 7.3 Standard Live Test Workspace

Each live test run must create its own temporary workspace with:

- a known path under the system temp directory
- a tiny seed repository or folder
- a small text file to inspect

Recommended seed files:

- `README.md`
- `sample.txt`

## 7.4 Standard Live Test Scenarios

Every agent live test must execute these scenarios through the public API:

### Scenario A: Health And Session Creation

1. Start daemon on a random localhost port.
2. Wait for `GET /api/health` success.
3. Create a session in `plan` mode with a harmless inspection prompt.
4. Verify a session id is returned and at least one assistant event arrives.

### Scenario B: Mode Verification

1. In `plan` mode, send:
   - "Inspect the workspace and propose two steps to update sample.txt. Do not modify files."
2. Verify:
   - a final response arrives
   - `sample.txt` remains unchanged

### Scenario C: Build Verification

1. Switch to `build` mode.
2. Update policy so writes are allowed and approvals are `on-request`.
3. Send:
   - "Create a file named LIVE_TEST_OUTPUT.txt with exact contents live test ok"
4. If an approval appears, resolve it through `/pending/:id/resolve`.
5. Verify:
   - final response arrives
   - `LIVE_TEST_OUTPUT.txt` exists
   - file contents match exactly

### Scenario D: Session Termination

1. Terminate the session through the public API.
2. Verify a `session.terminated` event appears.
3. Verify the session status becomes `terminated`.

### Scenario E: Persistence Verification

1. Read `/api/sessions/:id/events`.
2. Verify the log contains:
   - `session.started`
   - at least one `assistant.final`
   - `session.terminated`
3. Verify the on-disk event log exists and is non-empty.

## 7.5 Optional Live Scenario

If the adapter can surface questions in a deterministic way, add:

- one question request and resolution flow

This is optional because not every vendor may expose a predictable question prompt in a stable automated manner.

## 8. CI Expectations

Required CI jobs:

- lint and typecheck
- unit and integration tests
- browser E2E tests on at least one supported OS

Live tests may run in a dedicated environment and are not required for every pull request, but they must be runnable on demand and in release validation.

## 9. Required Test Fixtures

- fake adapter implementation
- fake event source helper
- temporary workspace factory
- storage-root sandbox helper
- daemon launcher helper for tests
- WebSocket client helper with resume cursor support

## 10. Release Gate

The product is not releasable unless:

- all non-live tests pass
- at least one live test path has been exercised successfully for each built-in adapter in a suitable environment
- unresolved flaky tests are tracked and below the team's defined threshold

## 11. Manual Validation Checklist

Before release, a human should confirm:

- dashboard session creation feels responsive
- doctor guidance is understandable for missing prerequisites
- pending approvals and questions are obvious in the UI
- reconnect after browser refresh feels seamless
- force terminate behaves safely and clearly
