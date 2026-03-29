# Implementation Work Packages

## 1. Purpose

This document turns the repaired `docs/` contract into an execution-ready delivery order.

The work packages are intentionally staged so the project does not race into adapter or UI polish before the contract, replay model, and verification scaffolding are sound.

## 2. Dependency Order

Recommended high-level order:
1. docs audit and architecture decision gate
2. docs repair and release-gate definition
3. test/fixture scaffolding
4. core runtime, reducer/materializer, storage, auth, recovery
5. API, WebSocket, CLI
6. browser UI completion
7. Codex adapter
8. Claude adapter
9. OpenCode adapter
10. hardening, performance, and release validation

## 3. Work Package A — Docs Audit And Architecture Gate

Scope:
- compare every spec document with current code reality
- resolve ambiguities and missing requirements
- decide whether the current Fastify + modular SPA architecture remains the production baseline

Deliverables:
- resolved gap matrix
- explicit keep-vs-refactor decision
- updated production constraints that will govern implementation

Exit criteria:
- every critical docs/code gap has an owner: normative requirement, explicit de-scope, or architecture decision
- the architecture decision gate is recorded before broad implementation continues

## 4. Work Package B — Docs Repair

Scope:
- update all `docs/*.md` so the contract is internally consistent, execution-ready, and release-ready
- define prepared-environment live semantics
- split minimum releasable adapter transport from optional attach/tmux affordances

Deliverables:
- revised docs set
- explicit release gate
- implementation steps and milestone ordering aligned with this document

Exit criteria:
- docs are sufficient for implementation without hidden assumptions
- release evidence requirements are explicit

## 5. Work Package C — Test And Fixture Scaffolding

Scope:
- add missing unit/integration fixtures
- establish Playwright E2E scaffolding
- establish live-test workspace helpers and per-adapter prerequisite checks

Deliverables:
- reusable fake adapter harness
- daemon launcher and websocket helpers
- initial Playwright suite structure
- live-test helpers and prepared-environment checks

Exit criteria:
- `npm run test:e2e` executes real tests instead of failing with “No tests found”
- test helpers are ready before broad runtime/UI churn

## 6. Work Package D — Core Runtime And Storage

Scope:
- reducer/materializer implementation or refactor
- session mutation serialization
- durable event/snapshot/index handling
- retention/pruning
- auth hardening
- recovery and adapter reconciliation hooks

Deliverables:
- stable session truth model
- explicit replay/recovery logic
- production-ready storage behaviors

Exit criteria:
- unit/integration suites cover idempotency, pending lifecycle, recovery, and terminate flows
- replay truth is driven by one shared reducer/materializer model

## 7. Work Package E — HTTP API, WebSocket, And CLI

Scope:
- full API contract from `api.md`
- cursor/idempotency/restart semantics
- websocket subscribe/replay behavior
- CLI parity for required daemon and session flows

Deliverables:
- stable API and websocket contract
- CLI flows that exercise the same runtime/storage model as the browser

Exit criteria:
- integration tests prove request validation, replay semantics, auth, and session control flows

## 8. Work Package F — Browser UI Completion

Scope:
- dashboard search/filter/readiness
- complete workspace controls and metadata
- settings and doctor clarity
- reconnect behavior without duplication
- accessibility and responsive behavior

Deliverables:
- complete browser UX for required product flows

Exit criteria:
- Playwright passes required dashboard/workspace/settings/reconnect flows

## 9. Work Package G — Codex Adapter

Scope:
- stabilize the existing Codex transport against the repaired docs contract
- keep create/resume/message/mode/policy/pending/terminate flows truthful
- align capability reporting, plan-mode semantics, and doctor output with the documented contract
- keep live-test coverage green while docs and UI truth are repaired

Deliverables:
- production-truthful Codex adapter contract
- Codex live validation path that remains green

Exit criteria:
- Codex capability reporting matches docs/UI/API behavior
- prepared-environment live validation remains successful

## 10. Work Package H — Claude Adapter

Scope:
- stabilize the existing Claude transport against the repaired docs contract
- emulate plan mode truthfully when native mode is unavailable
- keep approval resolution, resume behavior, and capability reporting truthful
- keep live-test coverage green while docs and UI truth are repaired

Deliverables:
- production-truthful Claude adapter contract
- Claude live validation path that remains green

Exit criteria:
- Claude capability reporting matches docs/UI/API behavior
- prepared-environment live validation remains successful

## 11. Work Package I — OpenCode Adapter

Scope:
- stabilize the existing OpenCode transport against the repaired docs contract
- keep prerequisite checks and honest capability reporting aligned with reality
- preserve the live validation path for prepared environments
- keep live-test coverage green while docs and UI truth are repaired

Deliverables:
- production-truthful OpenCode adapter contract
- OpenCode live validation path that remains green

Exit criteria:
- OpenCode capability reporting matches docs/UI/API behavior
- prepared-environment live validation remains successful when prerequisites are installed

## 12. Work Package J — Hardening

Scope:
- reconnect and daemon-restart polish
- performance tuning for long histories
- security review for auth, secrets, and capability reporting
- observability and pruning verification

Deliverables:
- release-ready recovery and diagnostics behavior

Exit criteria:
- required performance/recovery checks pass
- required logs/metrics/counters are present and redacted correctly

## 13. Parallelization Guidance

Safe parallel tracks begin only after Work Package B and preferably after Work Package C.

Safe parallel lanes:
- core runtime / API
- browser UI
- adapter implementation by vendor
- release verification

Shared rules:
- all lanes depend on one reducer/materializer truth model
- docs are frozen before broad parallel implementation begins
- optional affordances such as attach/open-directory must not force cross-lane blockers
- teams should use small, reviewable commits and push after each green milestone so later lanes inherit a stable base

## 14. Final Release Checklist

The release checklist is complete only when all items below are checked:

### Contract
- [ ] `docs/` is internally consistent and aligned with shipped behavior
- [ ] architecture decision gate outcome is recorded and honored
- [ ] `production-readiness.md` blocking conditions are cleared

### Automated verification
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run test:e2e`
- [ ] `npm run test:live -- --agent codex`
- [ ] `npm run test:live -- --agent claude`
- [ ] `npm run test:live -- --agent opencode`

### Product readiness
- [ ] dashboard/session/settings/doctor flows meet the product spec
- [ ] replay/recovery behavior matches the architecture and storage specs
- [ ] capability-gated affordances are honest and functional where declared

### Operational readiness
- [ ] doctor output surfaces missing prerequisites clearly
- [ ] structured logs and required counters/metrics exist and redact secrets
- [ ] pruning/retention behavior is implemented and observable
- [ ] release evidence is archived under `.omx/validation/`
- [ ] modular commits were made at milestone boundaries and pushed after each green gate

### Human validation
- [ ] manual checklist from `testing-and-live-validation.md` is complete
- [ ] prepared-environment live evidence exists for each built-in adapter
