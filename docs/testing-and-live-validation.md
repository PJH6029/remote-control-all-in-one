# Testing And Live Validation Specification

## 1. Purpose

The verification strategy must prove all of the following:
- the normalized core behaves correctly without vendor binaries
- the browser UI works end to end against real runtime behavior
- each built-in adapter works through public product surfaces
- recovery, replay, and retention behavior are reliable
- the release gate is backed by prepared-environment evidence, not local guesswork

## 2. Required Test Layers

The project must ship with these layers:
- unit tests
- integration tests
- browser E2E tests
- live tests
- manual release validation checklist

## 3. Required Package Scripts

At minimum, the implementation must expose and keep working:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:unit`
- `npm run test:int`
- `npm run test:e2e`
- `npm run test:live`
- `npm run check`

`npm run check` must aggregate the fast non-live checks appropriate for CI and local development.

## 4. Baseline Reality Check

At the time these docs were repaired, the repository baseline was:
- `npm run check` passes in the current workspace, but clean-tree lint can fail when `test-results/` is absent
- `npm run test:e2e` fails because the dashboard stays on the shell/banner state long enough for the current assertions to time out
- live tests currently pass for Codex, Claude, and OpenCode
- the dashboard still needs faster first-paint / async-readiness behavior to meet the release target

This baseline is acceptable only as a starting point. It is not acceptable for release.

## 5. Unit Tests

Unit coverage must include:
- config parsing, defaults, env overrides, and mutable-setting classification
- auth/session/CSRF helpers
- redaction behavior
- schema validation for config, API payloads, snapshots, event lines, and adapter options
- reducer/materializer transitions
- event sequencing and replay helpers
- idempotency helpers
- retention/pruning calculations
- doctor summary formatting
- adapter parser/mapping helpers

Required edge cases:
- duplicate create-session idempotency keys
- duplicate message client ids
- stale pending-action resolution
- invalid mode transitions
- crash-truncated event log replay
- snapshot rebuild after missing or stale active-session index
- secret redaction in nested payloads

## 6. Integration Tests

Integration tests must run against real storage and a deterministic fake adapter harness.

The fake adapter framework must simulate:
- delayed streaming
- approval requests
- question requests
- plan requests
- restart-required mode changes
- restart-required policy changes
- graceful termination
- forced termination after timeout
- crash on startup
- crash during run

Required integration scenarios:
- create session and receive first normalized events
- send message and receive commentary/final output
- resolve approval allow
- resolve approval deny
- resolve question with freeform answer
- resolve plan with `accept`
- resolve plan with `stay_in_plan`
- switch mode without restart
- switch mode with restart-required transition
- update execution policy with truthful restart reporting
- terminate gracefully
- force terminate after timeout
- browser-refresh replay from `afterSequence`
- daemon-restart recovery from snapshot + event log + adapter reconciliation
- attach capability fallback behavior
- doctor/bootstrap/status flows

## 7. Browser E2E Tests

Browser E2E tests must use Playwright and exercise the real daemon through browser-visible flows.

Required scenarios:
- bootstrap or login handoff
- dashboard shell render before slow readiness calls finish
- eventual adapter readiness / doctor hydration
- create session from dashboard
- workspace transcript streaming
- pending approval resolution in UI
- pending question resolution in UI
- plan decision flow in UI
- mode toggle and policy update in UI
- terminate and force-terminate in UI
- settings edit and persistence
- reconnect after backend restart

Required assertions:
- optimistic user message appears and reconciles
- no duplicate transcript entries after reconnect
- pending-action cards disappear or change state after resolution
- disabled or hidden controls match capability flags, including any plan-request affordance that is not supported for a given adapter
- visible focus states and keyboard navigation work for critical controls
- required live regions announce pending state and session-status changes

## 8. Live Tests

Live tests must use the public API and public auth flow only.

Required entry points:
- `npm run test:live -- --agent codex`
- `npm run test:live -- --agent claude`
- `npm run test:live -- --agent opencode`

### 8.1 Exit Codes

- `0` success
- `1` functional failure
- `2` blocked by missing binary, missing auth, missing tmux when required, insufficient vendor credits/quota, or another documented prerequisite

Blocked is informative. It is never counted as success.

Current passing live validation must remain green while the browser and clean-tree blockers are fixed.

### 8.2 Prepared-Environment Requirement

A release candidate is not production-ready until each built-in adapter has at least one successful live validation in a **prepared environment** where:
- the adapter binary is installed
- the adapter is authenticated if required
- the account has sufficient credits/quota when the vendor enforces it
- tmux is available when the transport requires it
- the working directory and permissions are configured as the adapter expects

Local developer runs may still return `2`. Release validation may not.

### 8.3 Standard Live Test Workspace

Each live run must create an isolated temporary workspace containing at minimum:
- `README.md`
- `sample.txt`
- any tiny fixture files needed to verify plan vs build behavior

### 8.4 Standard Live Scenarios

Every adapter live test must execute these scenarios through public product surfaces:

#### Scenario A — Health And Session Creation
1. start daemon on a random localhost port
2. wait for `GET /api/health`
3. create a session in `plan` mode with a non-mutating inspection prompt
4. verify a session id is returned and at least one assistant event arrives

#### Scenario B — Plan Mode Verification
1. send a prompt that requires analysis but forbids file mutation
2. verify a final response arrives
3. verify seed files remain unchanged

#### Scenario C — Build Mode Verification
1. switch to `build` mode
2. update policy so the requested write path is allowed
3. send a prompt that creates or edits a known file with exact contents
4. resolve approvals through the public pending-action route if surfaced
5. verify file contents exactly

#### Scenario D — Session Termination
1. terminate the session
2. verify termination event appears
3. verify the session summary transitions to `terminated`

#### Scenario E — Persistence Verification
1. read session events through the public API
2. verify required lifecycle events are present
3. verify persisted event log and snapshot files exist and are non-empty

## 9. Observability And Performance Validation

The verification suite or release checklist must collect evidence for:
- warm startup to usable dashboard shell under target bounds
- slow probe hydration must not block initial usability
- first visible session state under target bounds
- reconnect to visible transcript under target bounds
- replay correctness with at least 10,000 events per session
- retained-history correctness with at least 100 active/recent sessions
- redacted structured logs and required counters/metrics
- release evidence captured under `.omx/validation/`

## 10. Required Fixtures And Helpers

Required shared helpers:
- fake adapter harness
- storage-root sandbox helper
- daemon launcher helper
- websocket client helper with resume-cursor support
- temporary workspace factory
- per-adapter live workspace seed helper

## 11. CI Expectations

Required CI jobs:
- lint + typecheck
- unit + integration tests
- browser E2E tests on at least one supported OS

Live tests may run in a dedicated environment instead of every pull request, but they must be runnable on demand and required for release validation.

## 12. Release Gate

The project is not releasable until:
- all non-live tests pass on a clean checkout
- browser E2E tests pass
- prepared-environment live validation succeeds for each built-in adapter
- blocked live tests are never reported as success
- manual validation checklist is complete
- unresolved flaky tests are documented and below the release threshold
- release evidence is archived under `.omx/validation/`

## 13. Manual Validation Checklist

Before release, a human must confirm:
- dashboard session creation feels responsive
- doctor guidance is understandable when prerequisites are missing
- pending approvals/questions/plans are obvious and actionable
- reconnect after refresh feels seamless
- force terminate is safe and clear
- capability-gated affordances (attach/open-directory) are either functional or honestly disabled
- release evidence bundle is present under `.omx/validation/`
