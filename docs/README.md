# Project Specification

This `docs/` directory is the production contract for **Remote Control All-in-One**: a local-first browser control plane for CLI coding agents.

The contract has two jobs:
1. define the product that must exist at release time
2. define the implementation and verification gates required to call the project production-ready

## Scope

V1 is a **single-user**, **local-first** application that:
- launches and manages supported coding-agent sessions on the local machine
- exposes a browser-based control plane instead of relying on chat-platform UIs
- supports multiple agent backends through a normalized adapter boundary
- preserves durable session state through normalized events and snapshots
- can be verified with automated non-live tests, browser E2E tests, and prepared-environment live tests

## Reading Order

1. [product-spec.md](./product-spec.md)
   - user-facing product behavior, required flows, required UI surfaces, and UX/security requirements
2. [architecture.md](./architecture.md)
   - runtime model, state truth, recovery rules, module boundaries, and architecture decision gate
3. [agent-adapters.md](./agent-adapters.md)
   - normalized adapter contract and the release requirements for Codex, Claude Code, and OpenCode
4. [api.md](./api.md)
   - HTTP and WebSocket contract, replay semantics, auth rules, and idempotency requirements
5. [config-storage.md](./config-storage.md)
   - config shape, persistent storage, temp namespaces, retention/pruning, and recovery precedence
6. [testing-and-live-validation.md](./testing-and-live-validation.md)
   - required test pyramid, prepared-environment live validation, release evidence, and exit codes
7. [production-readiness.md](./production-readiness.md)
   - release gate, prepared-environment assumptions, evidence bundle, and blocking conditions
8. [work-packages.md](./work-packages.md)
   - execution-ready implementation phases and the final release checklist

## Locked Product Decisions

- V1 is local-first and single-user.
- The daemon binds to `127.0.0.1` by default.
- Non-loopback hosting is opt-in and requires password auth.
- The browser UI and CLI operate on the same core runtime and persisted state.
- Normalized events and materialized snapshots are the source of truth; raw terminal output is supplemental.
- Attach and open-directory affordances are capability-gated optional features, not universal guarantees.
- Every built-in adapter must ship with a **minimum releasable transport** even if optional attach/tmux behavior differs by vendor.
- Plan requests are distinct from plan mode: plan mode is a session mode, while plan requests travel through pending actions of type `plan`.
- The current repository baseline keeps the Fastify + server-served modular SPA approach unless the architecture decision gate explicitly requires refactoring.
- The implementation should land in small, reviewable commits and be pushed after each green milestone.
- Release readiness is defined by passing evidence, not by partial feature presence.

## Deliverables Required By This Spec

A v1 release must include:
- a runnable local daemon
- a browser UI with dashboard, session workspace, settings, and doctor surfaces
- CLI commands for bootstrap, daemon control, agent inspection, and session control
- a normalized runtime with session manager, reducer/materializer, event storage, recovery, and observability hooks
- working built-in adapters for Codex, Claude Code, and OpenCode
- prepared-environment live-test paths for all built-in adapters
- documentation aligned with the shipped implementation and release gate

## Implementation Sequencing Rule

The implementation must proceed in this order:
1. repair and align `docs/`
2. lock behavior with tests and fixtures
3. harden core runtime, storage, replay, and auth
4. complete API, WebSocket, CLI, and UI
5. stabilize built-in adapters and capability reporting against the repaired contract
6. complete release validation and manual evidence collection

No phase may claim completion until its verification gates pass.

## Definition Of Done

The project is done for v1 only when all of the following are true:
- the revised docs are internally consistent and sufficient to guide implementation without hidden assumptions
- the web UI can create, stream, control, recover, and terminate sessions for all built-in adapters
- required API and WebSocket behavior from [api.md](./api.md) is implemented and verified
- storage, retention, pruning, and recovery rules from [config-storage.md](./config-storage.md) are implemented and verified
- adapter requirements from [agent-adapters.md](./agent-adapters.md) are satisfied for Codex, Claude Code, and OpenCode
- all required tests from [testing-and-live-validation.md](./testing-and-live-validation.md) pass
- each built-in adapter has at least one successful prepared-environment live validation path
- release evidence includes automated results, recovery/performance evidence, and manual validation checklist completion
- release evidence is stored in a reproducible repo-local bundle under `.omx/validation/`

## Release Semantics

- A local developer machine may legitimately report a live test as **blocked** (`exit 2`) when a binary, auth state, or other documented prerequisite is missing.
- A **release candidate** may only be called production-ready after live validation succeeds in a **prepared environment** where all built-in adapter prerequisites are satisfied.
- Blocked local validation is informative; it is not a substitute for prepared-environment release evidence.
- Current baseline note: Codex, Claude Code, and OpenCode live validation paths are already working and must stay working.

## External References

These references inform feasibility and integration strategy. They do not override this spec.

- Codex docs:
  - https://developers.openai.com/codex/
- Claude Code docs:
  - https://docs.claude.com/en/docs/claude-code
- OpenCode docs:
  - https://opencode.ai/docs/
