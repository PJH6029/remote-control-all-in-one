# Implementation Work Packages

## 1. Purpose

This document breaks the project into execution-ready work packages so later agents can plan and implement in parallel without inventing the system structure.

## 2. Dependency Order

Recommended high-level order:

1. shared schemas and config
2. event store and session manager
3. server API and WebSocket layer
4. browser UI shell
5. Codex adapter
6. Claude adapter
7. OpenCode adapter
8. testing and live validation
9. packaging and polish

## 3. Work Package A: Project Skeleton

Scope:

- initialize source layout
- add lint, typecheck, test, and build tooling
- establish shared runtime validation and schema utilities

Deliverables:

- working package scripts
- shared type and schema modules
- logging utility
- error utility

Exit criteria:

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit` with at least baseline schema tests

## 4. Work Package B: Config And Storage Layer

Scope:

- config loader
- config validator
- storage root helper
- snapshot read and write
- event log append and replay
- active session index

Deliverables:

- config module
- storage module
- retention module

Exit criteria:

- config validation tests pass
- snapshot and event replay tests pass
- crash-safe append behavior is covered by tests

## 5. Work Package C: Core Session Runtime

Scope:

- session manager
- event bus
- session materializer or reducer
- pending action lifecycle
- mode and policy transition logic

Deliverables:

- session service with create, message, mode, policy, resolve, terminate
- normalized session state machine

Exit criteria:

- fake-adapter integration tests cover all core flows
- state rebuild from events works deterministically

## 6. Work Package D: HTTP API And WebSocket

Scope:

- health route
- agents route
- sessions routes
- settings route
- doctor route
- WebSocket subscription and resume behavior

Deliverables:

- complete API contract from [api.md](./api.md)
- request validation
- response envelopes
- auth middleware

Exit criteria:

- API integration tests pass
- WebSocket reconnect and cursor tests pass

## 7. Work Package E: Browser UI Foundation

Scope:

- app shell
- routing
- connection management
- dashboard
- session workspace shell
- settings and doctor shell

Deliverables:

- browser app that can render static and fake-adapter driven data

Exit criteria:

- Playwright can load dashboard and workspace against fake adapter flows

## 8. Work Package F: Session Workspace UX

Scope:

- transcript rendering
- composer
- pending action cards
- terminal mirror
- metadata panel
- mode and policy controls

Deliverables:

- complete workspace interaction model

Exit criteria:

- browser E2E passes for create session, stream output, resolve pending action, and terminate

## 9. Work Package G: Codex Adapter

Scope:

- Codex probe
- per-session config generation
- notify hook integration
- session log relay
- mode mapping
- approval and sandbox mapping
- tmux attach support

Deliverables:

- fully functional Codex adapter with live-test coverage

Exit criteria:

- Codex integration tests pass
- `npm run test:live -- --agent codex` can pass in a prepared environment

## 10. Work Package H: Claude Adapter

Scope:

- Claude binary and auth probe
- per-session settings and hook generation
- `PermissionRequest` handling
- `SessionStart` and `SessionEnd` lifecycle mapping
- plan-mode emulation through official hooks and permissions
- tmux attach support

Deliverables:

- fully functional Claude adapter with live-test coverage

Exit criteria:

- Claude integration tests pass
- `npm run test:live -- --agent claude` can pass in a prepared environment

## 11. Work Package I: OpenCode Adapter

Scope:

- OpenCode probe
- local server lifecycle management
- session create and resume through official transport
- built-in build and plan mapping
- permission handling
- optional attach behavior if transport supports it

Deliverables:

- fully functional OpenCode adapter with live-test coverage

Exit criteria:

- OpenCode integration tests pass
- `npm run test:live -- --agent opencode` can pass in a prepared environment

## 12. Work Package J: Doctor And Setup

Scope:

- bootstrap command
- daemon start and stop commands
- doctor output in CLI and UI
- remediation text for missing dependencies

Deliverables:

- first-run setup flow
- `agents doctor`
- `daemon status`

Exit criteria:

- first-run setup works on a prepared machine
- doctor surfaces blocked prerequisites clearly

## 13. Work Package K: Hardening

Scope:

- reconnect behavior
- restart recovery
- retention and pruning
- security review for auth and secret redaction
- performance tuning for long transcripts

Deliverables:

- stable recoverability behavior
- release-ready retention rules

Exit criteria:

- reconnect and daemon restart browser E2E tests pass
- manual validation checklist from [testing-and-live-validation.md](./testing-and-live-validation.md) is satisfied

## 14. Parallelization Guidance

Safe parallel tracks after Work Package C:

- API and WebSocket work
- browser UI foundation
- adapter implementation per vendor

Shared-contract rule:

- all parallel tracks must depend on the same shared schemas and event types
- adapter work must not fork the normalized contract

## 15. Final Release Checklist

- all required scripts exist
- docs and implementation agree on API and event names
- all built-in adapters have doctor coverage
- all built-in adapters have live-test coverage
- browser UI is usable on desktop and acceptable on tablet or mobile
- default local auth and bind behavior are safe
