# Agent Adapter Specification

## 1. Purpose

Adapters translate the product's normalized session model into vendor-specific runtime behavior. The rest of the application must interact with every built-in agent through the same normalized contract.

Built-in adapters for v1:
- Codex
- Claude Code
- OpenCode

## 2. Adapter Release Rule

Every built-in adapter must ship with a **minimum releasable transport** that supports the core session lifecycle.

Optional affordances such as `tmux` attach or open-directory actions may be omitted or disabled unless the chosen transport supports them safely and truthfully.

## 3. Normalized Adapter Contract

Each production adapter must support these normalized operations:

```ts
type AdapterId = 'codex' | 'claude' | 'opencode'

interface AgentAdapter {
  id: AdapterId
  displayName: string
  probe(): Promise<AdapterProbeResult>
  capability(): AdapterCapability
  optionSchema(): Promise<AdapterOptionSchema>
  createSession(input: SessionCreateSpec, context: AdapterContext): Promise<AdapterSessionHandle>
  resumeSession(input: ResumeSessionSpec, context: AdapterContext): Promise<AdapterSessionHandle>
}

interface AdapterSessionHandle {
  sendMessage(input: SendUserMessageInput): Promise<void>
  setMode(input: SetModeInput): Promise<ModeChangeResult>
  updateExecutionPolicy(input: UpdateExecutionPolicyInput): Promise<PolicyChangeResult>
  resolvePending(input: ResolvePendingInput): Promise<void>
  terminate(input: TerminateSessionInput): Promise<TerminateResult>
  reconcile?(): Promise<void>
}
```

The adapter owns:
- vendor launch and resume behavior
- per-session config/hook generation
- transport selection
- vendor event parsing
- vendor error normalization
- vendor-specific temp files/state

The adapter does **not** own:
- normalized session ids
- public API behavior
- browser rendering
- durable normalized event storage

## 4. Required Normalized Types

### 4.1 SessionCreateSpec

Required fields:
- `agentId`
- `cwd`
- `title`
- `initialPrompt`
- `mode`
- `executionPolicy`
- `extraDirectories`
- `adapterOptions`

### 4.2 AgentCapability

Required fields:
- `agentId`
- `displayName`
- `transport`
- `supportsPlanMode`
- `supportsModeSwitch`
- `supportsExecutionPolicySwitch`
- `supportsPendingApprovals`
- `supportsQuestions`
- `supportsPlanRequests`
- `supportsTmuxAttach`
- `supportsStructuredEvents`
- `supportsResume`
- `supportsForceTerminate`
- `supportsLocalBrowserOpen`

Optional fields:
- `planModeImplementation`
- `executionPolicyImplementation`
- `notes`

### 4.3 AdapterProbeResult

Required fields:
- `agentId`
- `installed`
- `binaryPath`
- `version`
- `authenticated`
- `tmuxAvailable`
- `status`
- `summary`
- `details`

### 4.4 AdapterOptionSchema

Each adapter must expose a JSON-schema-compatible advanced option descriptor.

Rules:
- common session fields must not be duplicated in adapter-specific schema
- unsupported vendor flags must not be surfaced as if supported
- browser rendering must be able to consume the schema safely

## 5. Normalized Event Requirements

Required public event types:
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
- normalized events must be safe to persist and replay
- one vendor event must not map to conflicting public meanings
- terminal output must never be the only source for approvals/questions/plans
- plan requests are represented as `type: plan` pending actions plus the `plan.requested` / `plan.resolved` event pair; this is distinct from `mode: plan`

## 6. Pending Action Normalization

Any adapter that surfaces structured pending actions must normalize them to one shared shape with:
- id
- session id
- type (`approval`, `question`, `plan`)
- status (`open`, `resolved`, `expired`, `invalidated`)
- prompt
- options
- timestamps
- optional vendor payload

Capability rules:
- adapters may support none, some, or all structured pending-action types
- `supportsPendingApprovals`, `supportsQuestions`, and `supportsPlanRequests` are authoritative for UI/API behavior
- unsupported pending-action types must not be implied by plan-mode support or other lifecycle features

Resolution requirements for supported types:
- approvals support allow and deny
- questions support freeform text submission
- plan requests support at least `accept` and `stay_in_plan`

Plan requests must remain distinct from plan mode:
- plan mode is a session mode exposed through `supportsPlanMode` and `planModeImplementation`
- plan requests are a pending-action path surfaced through `type: plan` and the `plan.*` events
- docs, doctor output, and UI controls must not conflate the two concepts

## 7. Mode Semantics

All adapters must support normalized `build` and `plan` modes.

Rules:
- native plan mode must be used when the vendor provides it
- otherwise the adapter must emulate plan mode with the safest available policy plus explicit instructions/tool restrictions
- the UI and doctor must report whether plan mode is native or emulated
- plan mode support does not imply plan-request support; the latter is surfaced by pending-action/event behavior

## 8. Execution Policy Mapping

Normalized execution policy:
- filesystem: `read-only` | `workspace-write` | `danger-full-access`
- network: `off` | `on`
- approvals: `never` | `on-request`
- writable roots: string[]

Rules:
- use native vendor approval/sandbox controls when available
- otherwise enforce the closest safe behavior and report limitations honestly
- capability metadata must describe the effective implementation, not a wishful one

## 9. Attach And Open-Directory Semantics

- attach is allowed only when the adapter reports `supportsTmuxAttach = true`
- open-directory is allowed only when the platform/runtime can support it safely
- unsupported affordances must be hidden or disabled with explanatory text
- lack of attach support does not block release of the adapter's minimum releasable transport

## 10. Codex Adapter

### 10.1 Required official surfaces

The Codex adapter must use current official Codex surfaces such as:
- CLI invocation
- per-session config or config overrides
- native approval/sandbox settings (`approval_policy`, `sandbox_mode`, writable roots, network settings)
- notification or structured output surfaces such as `notify` and JSON event output where appropriate
- supported session continuation/resume behavior when available

### 10.2 Required behavior

- create and continue sessions through official Codex entry points
- map normalized build/plan semantics truthfully onto Codex behavior
- map normalized execution policy onto supported sandbox/approval controls
- surface structured approvals/questions/plan requests only when official outputs actually expose them; otherwise keep the corresponding capability flags false
- persist enough adapter state to resume or reconcile sessions when supported

### 10.3 Required capabilities

- supports plan mode
- supports mode switch
- supports execution policy switch
- does **not** need to claim structured approval/question/plan-request support when the chosen transport does not expose it
- supports resume when the chosen flow supports continuation
- supports attach only if the chosen transport exposes a stable local target

## 11. Claude Code Adapter

### 11.1 Required official surfaces

The Claude adapter must use current official Claude Code surfaces such as:
- CLI invocation
- per-session settings/hook configuration
- official lifecycle and permission hooks (for example session start/end, prompt submission, permission-related hooks)
- supported continue/resume behavior when available

### 11.2 Required behavior

- create and continue sessions through supported Claude flows
- surface approvals through official permission-related hooks
- emulate plan mode truthfully when native mode is unavailable
- inject answers to structured questions or plan requests only when the supported surface provides a truthful structured path
- use lifecycle hooks for cleanup and reconciliation where appropriate

### 11.3 Required capabilities

- supports plan mode (native or emulated)
- supports pending approvals
- supports questions only when the chosen surface supports structured answer injection
- supports plan requests only when the chosen surface exposes a truthful structured plan-request path
- supports attach only when the chosen transport exposes it truthfully

## 12. OpenCode Adapter

### 12.1 Required official surfaces

The OpenCode adapter must use current official OpenCode surfaces such as:
- server/API transport where appropriate
- supported session create/continue behavior
- official mode/agent configuration for build-like vs plan-like behavior
- official permission/config surfaces

### 12.2 Required behavior

- create and continue sessions through supported OpenCode transport
- map normalized build/plan semantics truthfully
- surface approvals/questions only when the chosen official surface actually exposes them
- surface plan requests only when the chosen official surface actually exposes them
- declare attach support only if the chosen transport provides a stable local attach target

### 12.3 Required capabilities

- supports plan mode
- supports resume when the chosen transport supports it
- supports structured events via the chosen official surface
- supports plan requests only when the chosen transport exposes them distinctly from plan mode
- attach is optional and capability-gated

## 13. Doctor Requirements

Each adapter must contribute checks for:
- binary presence
- version detection where possible
- authentication readiness when detectable
- required companion dependencies
- transport prerequisites
- resume readiness when relevant

Doctor output must include remediation text suitable for both CLI and browser UI.

## 14. Error Handling

Every adapter must normalize failures into `session.error` with:
- stable machine-readable `code`
- human-readable `message`
- optional `recoverable`
- optional `actionHint`

Required error categories include:
- binary missing
- authentication missing
- unsupported option
- launch failure
- transport disconnected
- resume failed
- permission resolution failed
- terminate timeout

## 15. Acceptance Criteria Per Adapter

A built-in adapter is done only when all of the following are true:
- it can be probed from doctor flows
- it can create a session from the dashboard
- it can stream normalized output into the workspace
- it can receive follow-up user input
- it distinguishes plan mode from plan requests in UI/API/doctor output
- it can resolve any supported approval/question/plan flows through normalized pending actions
- it can switch mode between `build` and `plan` truthfully
- it can terminate cleanly or report force-terminate behavior truthfully
- it can participate in the live-test contract from `testing-and-live-validation.md`
