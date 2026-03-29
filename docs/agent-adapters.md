# Agent Adapter Specification

## 1. Purpose

Adapters translate the product's normalized session model into vendor-specific runtime behavior. The rest of the application must treat every agent backend through the same core interface.

Built-in adapters required for v1:

- Codex
- Claude Code
- OpenCode

## 2. Adapter Contract

Each adapter must implement the following normalized contract:

```ts
type AdapterId = "codex" | "claude" | "opencode"

interface AgentAdapter {
  id: AdapterId
  displayName: string
  probe(): Promise<AdapterProbeResult>
  capabilities(): Promise<AgentCapability>
  optionSchema(): Promise<AdapterOptionSchema>
  createSession(spec: SessionCreateSpec): Promise<AdapterSessionHandle>
  resumeSession(session: PersistedSessionRecord): Promise<AdapterSessionHandle>
  sendUserMessage(input: SendUserMessageInput): Promise<void>
  setMode(input: SetModeInput): Promise<ModeChangeResult>
  updateExecutionPolicy(input: UpdateExecutionPolicyInput): Promise<PolicyChangeResult>
  resolvePending(input: ResolvePendingInput): Promise<void>
  terminate(input: TerminateSessionInput): Promise<TerminateResult>
}
```

The adapter owns:

- binary invocation
- per-session config or hook file generation
- transport selection
- vendor event parsing
- vendor resume logic
- vendor error normalization

The adapter does not own:

- session ids
- persistent event storage
- public API behavior
- browser rendering

## 3. Normalized Types

## 3.1 `SessionCreateSpec`

Required fields:

- `agentId`
- `cwd`
- `title`
- `initialPrompt`
- `mode`
- `executionPolicy`
- `extraDirectories`
- `adapterOptions`

Optional fields:

- `resumeFromSessionId`
- `environmentOverrides`
- `metadata`

## 3.2 `AgentCapability`

Required fields:

- `agentId`
- `displayName`
- `transport`
- `supportsPlanMode`
- `supportsModeSwitch`
- `supportsExecutionPolicySwitch`
- `supportsPendingApprovals`
- `supportsQuestions`
- `supportsTmuxAttach`
- `supportsStructuredEvents`
- `supportsResume`
- `supportsForceTerminate`
- `supportsLocalBrowserOpen`

Optional fields:

- `planModeImplementation`
  - `native`
  - `emulated`
- `executionPolicyImplementation`
  - `native`
  - `adapter_enforced`
  - `limited`
- `notes`

## 3.3 `AdapterProbeResult`

Required fields:

- `agentId`
- `installed`
- `binaryPath`
- `version`
- `authenticated`
- `tmuxAvailable`
- `status`
  - `healthy`
  - `warning`
  - `blocked`
- `summary`
- `details`

## 3.4 `AdapterOptionSchema`

Each adapter must expose a JSON-schema-compatible option descriptor for advanced launch options.

Required fields:

- `schema`
- `ui`
- `defaults`

Rules:

- common session fields must not be duplicated in adapter schema
- adapter schema must be serializable to config and API payloads
- unsupported or experimental vendor flags must be hidden unless explicitly enabled by adapter UI hints

## 4. Normalized Event Requirements

Every adapter must emit normalized events with the shared envelope from [api.md](./api.md).

Required event types:

- `session.started`
- `session.updated`
- `assistant.delta`
- `assistant.final`
- `user.sent`
- `approval.requested`
- `approval.resolved`
- `question.requested`
- `question.resolved`
- `plan.requested`
- `plan.resolved`
- `terminal.output`
- `session.terminated`
- `session.error`

Rules:

- normalized events must be idempotent at the event-store boundary
- every vendor event must map to at most one public meaning
- vendor chatter with no UI or state value may remain internal
- terminal output must never be the only path used to drive approvals or questions

## 5. Pending Action Normalization

All adapters must normalize pending actions to:

```ts
interface PendingAction {
  id: string
  sessionId: string
  type: "approval" | "question" | "plan"
  status: "open" | "resolved" | "expired" | "invalidated"
  prompt: string
  options: Array<{ id: string; label: string; kind?: "allow" | "deny" | "submit" | "cancel" }>
  defaultOptionId?: string
  createdAt: string
  expiresAt?: string
  vendorPayload?: Record<string, unknown>
}
```

Resolution rules:

- approvals must support allow and deny
- questions must support a freeform answer field
- plan confirmations must support at least `accept` and `stay_in_plan`

## 6. Mode Semantics

All adapters must support normalized `build` and `plan` mode.

### 6.1 Build Mode

Build mode allows implementation work subject to the current execution policy.

### 6.2 Plan Mode

Plan mode requires:

- inspect and analyze workspace
- propose steps and tradeoffs
- avoid file mutations unless the user explicitly switches back to build mode

If the vendor has no native plan mode, the adapter must emulate it by combining:

- read-only or equivalent execution policy
- explicit plan-mode instructions
- hook or permission enforcement that blocks write tools and write-like shell commands

## 7. Execution Policy Mapping

Normalized execution policy:

```ts
interface ExecutionPolicy {
  filesystem: "read-only" | "workspace-write" | "danger-full-access"
  network: "off" | "on"
  approvals: "never" | "on-request"
  writableRoots: string[]
}
```

Mapping rules:

- if the vendor supports native approval and sandbox flags, the adapter must use them
- if the vendor only partially supports the policy model, the adapter must enforce the closest safe behavior it can and declare limitations in capability metadata
- the UI and doctor must display the effective policy, not an overstated one

## 8. Attach Semantics

`sessions attach <id>` and the workspace attach control must open the underlying runtime only when the adapter declares `supportsTmuxAttach = true`.

If attach is unsupported:

- the CLI must exit cleanly with a clear explanation
- the UI must hide or disable attach with explanatory text

## 9. Codex Adapter

## 9.1 Integration Strategy

The Codex adapter must use official Codex surfaces:

- CLI invocation
- config file overrides
- `notify` command hook
- session history or session log relay
- native approval and sandbox settings
- native plan mode

## 9.2 Required Behavior

- Use `notify` to receive structured turn and attention events where available.
- Use Codex session logs or structured session output to capture commentary, plan updates, and final output that are not fully represented by `notify`.
- Map normalized `plan` mode to Codex native plan behavior.
- Map normalized execution policy to Codex approval and sandbox settings.
- Persist enough adapter state to resume the same vendor thread when supported.

## 9.3 Launch Requirements

The adapter must generate per-session config overrides instead of mutating user-global config.

Per-session launch must support:

- working directory
- model selection if exposed in adapter options
- reasoning effort if exposed in adapter options
- approval policy
- sandbox mode
- writable roots
- network toggle
- notify command

## 9.4 Required Capabilities

- `supportsPlanMode = true`
- `planModeImplementation = native`
- `supportsPendingApprovals = true`
- `supportsQuestions = true` if structured elicitation is detectable, otherwise `false`
- `supportsTmuxAttach = true`
- `supportsStructuredEvents = true`
- `supportsResume = true` when the selected launch path retains vendor session identity

## 10. Claude Code Adapter

## 10.1 Integration Strategy

The Claude adapter must rely on official Claude Code hooks and settings, not on terminal scraping.

Required official surfaces:

- CLI invocation
- per-session settings file
- hook configuration
- resume or continue flags when supported

Relevant hook events include:

- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `PermissionRequest`
- `PreToolUse`
- `PostToolUse`

## 10.2 Required Behavior

- Generate a per-session settings and hooks configuration owned by the adapter.
- Use `UserPromptSubmit` to observe user messages or inject metadata where useful.
- Use `PermissionRequest` to surface approvals as normalized pending actions.
- Use `PreToolUse` hook responses to emulate plan-mode restrictions when native plan mode is unavailable.
- Use `updatedInput` or the official answer-injection mechanism to satisfy agent questions through the browser UI.
- Use `SessionStart` and `SessionEnd` for lifecycle normalization and cleanup.

## 10.3 Plan Mode

Claude Code does not need a native plan mode to satisfy this product contract.

The Claude adapter must implement `plan` mode by:

- switching to a read-only or safest available policy
- injecting plan-only instructions
- denying write tools and write-like shell commands through hook or permission enforcement

Acceptance criteria:

- in `plan` mode, file write attempts are blocked
- the agent explains the plan instead of silently failing

## 10.4 Required Capabilities

- `supportsPlanMode = true`
- `planModeImplementation = emulated`
- `supportsPendingApprovals = true`
- `supportsQuestions = true`
- `supportsTmuxAttach = true`
- `supportsStructuredEvents = true`
- `supportsResume = true` if official resume works with the selected transport

## 11. OpenCode Adapter

## 11.1 Integration Strategy

The OpenCode adapter must prefer the official server or headless transport rather than scraping a local TUI.

Required official surfaces:

- `serve` server mode
- session creation and continuation APIs
- built-in `build` and `plan` agents
- permission handling surfaces
- plugin and event surfaces where needed

## 11.2 Required Behavior

- Start or connect to an adapter-owned OpenCode server endpoint.
- Create and resume sessions through the server transport.
- Map normalized `build` and `plan` to OpenCode built-in agents or equivalent server-side session parameters.
- Surface permission requests as normalized approvals.
- Declare attach support only if the chosen transport also exposes a stable local terminal target.

## 11.3 Security Note

OpenCode permissions are not sandboxing. The adapter must not claim sandbox isolation stronger than what the underlying process actually has.

## 11.4 Required Capabilities

- `supportsPlanMode = true`
- `planModeImplementation = native`
- `supportsPendingApprovals = true`
- `supportsQuestions = true` when supported by server event surfaces, otherwise `false`
- `supportsStructuredEvents = true`
- `supportsResume = true`
- `supportsTmuxAttach = false` by default in server mode

## 12. Adapter Error Handling

Every adapter must normalize failures into `session.error` with:

- stable machine-readable `code`
- human-readable `message`
- optional `recoverable`
- optional `actionHint`

Common required error categories:

- binary missing
- authentication missing
- unsupported option
- launch failure
- transport disconnected
- resume failed
- permission resolution failed
- terminate timeout

## 13. Doctor Requirements

Each adapter must contribute doctor checks for:

- binary presence
- version detection
- authentication readiness if detectable
- required companion dependencies
- transport prerequisites
- session resume readiness

Doctor output must include remediation text that can be shown both in CLI and browser UI.

## 14. Acceptance Criteria Per Adapter

Each built-in adapter is done only when all of the following are true:

- can be probed from `agents doctor`
- can create a session from the dashboard
- can stream normalized output into the workspace
- can receive follow-up user input
- can surface at least one approval or question flow if the vendor exposes it
- can switch mode between `build` and `plan`
- can terminate cleanly
- can be covered by the live-test contract in [testing-and-live-validation.md](./testing-and-live-validation.md)
