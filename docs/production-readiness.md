# Production Readiness Specification

## 1. Purpose

This document defines the release gate for v1. The project is not production-ready unless every requirement in this document is satisfied in addition to the product, architecture, adapter, API, storage, testing, and work-package documents.

## 2. Release philosophy

Production readiness means more than passing local unit tests. It requires:

- truthful docs that match the shipped code
- reliable runtime behavior under refresh, restart, and long transcripts
- honest adapter capability reporting
- explicit security and secrets-handling rules
- reproducible automated validation
- prepared-environment live validation for each built-in adapter

## 3. Required readiness domains

### 3.1 Contract readiness
- `docs/` is internally consistent.
- No critical behavior is left implicit.
- Every production-critical limitation is explicitly documented.
- Implementation and release steps are explicit enough for another agent to follow without rediscovery.

### 3.2 Runtime readiness
- Session creation, streaming, pending actions, policy changes, recovery, and termination behave correctly.
- Durable state survives daemon restart.
- Event replay and materialization preserve pending action truth and transcript ordering.
- No duplicate transcript items appear after reconnect or replay.

### 3.3 UX readiness
- Dashboard, workspace, settings, and doctor surfaces cover the required workflows.
- Required controls are keyboard-accessible and visibly focused.
- Error, empty, restarting, blocked, and reconnecting states are understandable.
- Critical actions remain available at required responsive breakpoints.

### 3.4 Adapter readiness
- Each built-in adapter supports the documented create, message, mode, policy, pending, terminate, and recovery behaviors.
- Each built-in adapter ships with a minimum releasable transport even if optional attach/tmux affordances differ.
- Capability metadata matches real behavior.
- Doctor output explains missing prerequisites with concrete remediation.
- Probe-only placeholders are not part of the release scope.

### 3.5 Security readiness
- Loopback is the default bind.
- Non-loopback bind requires password auth.
- Browser auth and CSRF protections are enforced for state-changing requests.
- Secrets are redacted from persisted logs, API responses, and doctor output.
- The product does not claim sandbox guarantees that exceed the underlying runtime.

### 3.6 Observability readiness
- Required logs are persisted and redacted.
- Required counters/metrics are emitted or materialized for inspection.
- Failures during startup, replay, probe, adapter launch, and event append are discoverable.
- Pruning actions are visible in logs.

### 3.7 Verification readiness
- All non-live test suites pass.
- Browser E2E suite passes.
- Live validation path exists for each built-in adapter.
- Manual validation checklist is completed.
- Release evidence is retained long enough for inspection.

## 4. Prepared-environment matrix

The project may be developed on a partially prepared machine, but v1 release validation assumes a prepared environment with:

- Node `>=20`
- npm
- tmux when required by the chosen adapter transport
- Codex installed and authenticated
- Claude Code installed and authenticated
- OpenCode installed and authenticated when its live path is exercised
- sufficient vendor credits/quota for any billed adapters exercised during release validation
- a recent Chromium-compatible browser for E2E execution

If a prerequisite is missing in a local development environment, the project may report the live path as blocked, but that does not satisfy the release gate.

## 5. Required evidence bundle

Before release, the following evidence must exist and be inspectable:

- latest passing output for `npm run lint`
- latest passing output for `npm run typecheck`
- latest passing output for `npm run test`
- latest passing output for `npm run test:e2e`
- latest live-test results for Codex, Claude, and OpenCode in prepared environments
- manual validation checklist completion record
- a short note confirming performance/recovery targets were exercised
- the repo-local evidence bundle under `.omx/validation/`

Evidence may be stored as CI artifacts, local logs, or structured validation notes, but it must be reproducible.

## 6. Blocking conditions

Release is blocked if any of the following are true:

- normative docs disagree with shipped behavior
- any required non-live test fails
- browser E2E coverage is missing or failing
- the dashboard shell is not usable until slow readiness probes complete
- any built-in adapter remains probe-only inside release scope
- live validation is unimplemented for any built-in adapter
- blocked live tests are misreported as success
- unresolved flaky failures exceed the team’s release threshold
- known secrets leakage or misleading security claims remain open
- docs and code disagree about how plan requests are represented distinct from plan mode
- the architecture decision gate remains unresolved or is violated by later implementation work

## 7. Final sign-off checklist

Before release, confirm all items below:

- docs repaired and aligned with code
- runtime recovery verified
- dashboard/workspace/settings/doctor flows verified
- Codex adapter verified
- Claude adapter verified
- OpenCode adapter verified in prepared environment
- logs and counters inspected for expected redaction and visibility
- manual validation checklist complete
- no open release-blocking defects remain
- release evidence bundle archived under `.omx/validation/`
