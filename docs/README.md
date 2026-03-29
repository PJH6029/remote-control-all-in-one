# Project Specification

This `docs/` directory is the implementation contract for a local-first web control plane for CLI coding agents. It is written to be portable into a fresh workspace and to stand on its own without any other repository context.

## Scope

The product is a single-user local application that:

- runs supported coding agents on the local machine
- exposes a browser-based control plane instead of a chat-platform UI
- supports multiple agent backends through a normalized adapter system
- provides enough structure for later agents to plan, implement, test, and live-test the project end to end

## Reading Order

1. [product-spec.md](./product-spec.md)
   Defines the user-facing product, supported flows, required screens, CLI behavior, and acceptance criteria.
2. [architecture.md](./architecture.md)
   Defines the runtime model, subsystem boundaries, eventing, state model, security boundaries, and recommended source layout.
3. [agent-adapters.md](./agent-adapters.md)
   Defines the normalized adapter contract and the specific requirements for Codex, Claude Code, and OpenCode.
4. [api.md](./api.md)
   Defines the HTTP and WebSocket contract, event envelope, error model, and required schemas.
5. [config-storage.md](./config-storage.md)
   Defines configuration, secrets handling, persistent storage, retention, recovery, and log formats.
6. [testing-and-live-validation.md](./testing-and-live-validation.md)
   Defines the required test pyramid, fixtures, CI expectations, and live-test contract.
7. [work-packages.md](./work-packages.md)
   Breaks implementation into parallelizable packages with exit criteria.

## Locked Product Decisions

- The application is local-first and single-user in v1.
- The primary interface is a web UI served from the local daemon.
- The daemon binds to `127.0.0.1` by default.
- Non-loopback hosting is opt-in and requires explicit password protection.
- The backend exposes a stable JSON API and a WebSocket event stream.
- Agent-specific integrations live behind a shared adapter contract.
- Session behavior is driven by normalized events and pending actions, not by terminal scraping in the UI.
- `tmux` remains the default attach mechanism for interactive local sessions when an adapter supports attach.
- Built-in adapters for v1 are Codex, Claude Code, and OpenCode.
- Persistent state is append-only for session events plus a resumable session snapshot.

## Deliverables Required By This Spec

- a runnable local daemon
- a browser UI with dashboard, session workspace, and settings/doctor views
- CLI commands for setup, daemon control, agent inspection, and session lifecycle
- a normalized core runtime with session manager, event bus, event store, and adapter layer
- working adapters for Codex, Claude Code, and OpenCode
- unit, integration, browser E2E, and live tests
- documentation generated from or aligned with these contracts

## Definition Of Done

The project is done for v1 only when all of the following are true:

- the web UI can create, stream, control, and terminate sessions for all supported adapters
- all public API endpoints in [api.md](./api.md) are implemented and tested
- all persistent state and recovery behavior in [config-storage.md](./config-storage.md) are implemented
- all adapter requirements in [agent-adapters.md](./agent-adapters.md) are met
- all required tests in [testing-and-live-validation.md](./testing-and-live-validation.md) pass
- each supported agent has a live validation path that exits `0` on success, `1` on failure, and `2` when blocked by missing prerequisites

## External References

These references inform feasibility and integration strategy. They do not override this spec.

- Official Codex docs and repository:
  - [https://developers.openai.com/codex/](https://developers.openai.com/codex/)
  - [https://github.com/openai/codex](https://github.com/openai/codex)
- Official Claude Code docs and repository:
  - [https://docs.claude.com/en/docs/claude-code](https://docs.claude.com/en/docs/claude-code)
  - [https://github.com/anthropics/claude-code](https://github.com/anthropics/claude-code)
- Official OpenCode docs and repository:
  - [https://opencode.ai/docs](https://opencode.ai/docs)
  - [https://github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
- Community add-on references:
  - [https://github.com/Yeachan-Heo/oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex)
  - [https://github.com/yeachan-heo/oh-my-claudecode](https://github.com/yeachan-heo/oh-my-claudecode)
  - [https://github.com/code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
