import { createId } from '../shared/ids';
import type { AdapterCapability, AdapterProbeResult, CreateSessionInput, PendingAction } from '../shared/contracts';
import type { AgentAdapter, AdapterCreateContext, AdapterResumeInput, AdapterSessionHandle, PendingResolution } from './base';

function delayed(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FakeAdapter implements AgentAdapter {
  readonly id = 'fake';
  readonly displayName = 'Fake Adapter';

  capability(): AdapterCapability {
    return {
      agentId: this.id,
      displayName: this.displayName,
      transport: 'internal',
      supportsPlanMode: true,
      supportsModeSwitch: true,
      supportsExecutionPolicySwitch: true,
      supportsPendingApprovals: true,
      supportsQuestions: true,
      supportsPlanRequests: true,
      supportsTmuxAttach: false,
      supportsStructuredEvents: true,
      supportsResume: true,
      supportsForceTerminate: true,
      supportsLocalBrowserOpen: false,
      planModeImplementation: 'native',
      executionPolicyImplementation: 'adapter_enforced',
      notes: ['Deterministic internal adapter for tests and local demos.'],
    };
  }

  async probe(): Promise<AdapterProbeResult> {
    return {
      agentId: this.id,
      installed: true,
      binaryPath: null,
      version: 'internal',
      authenticated: true,
      tmuxAvailable: true,
      status: 'healthy',
      summary: 'Built-in fake adapter is ready.',
      details: ['Supports streaming, approvals, questions, plan requests, and terminal output simulation.'],
    };
  }

  async optionSchema(): Promise<Record<string, unknown>> {
    return {
      schema: { type: 'object', properties: {} },
      ui: {},
      defaults: {},
    };
  }

  async createSession(input: CreateSessionInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    await delayed(20);
    await this.emitAssistant(context, `Inspecting ${input.cwd} in ${input.mode} mode.`, `Fake session ready for: ${input.initialPrompt}`);

    return {
      sendMessage: async ({ text }) => {
        await this.handleMessage(text, context);
      },
      setMode: async () => ({ restartRequired: false }),
      updateExecutionPolicy: async () => ({ restartRequired: false }),
      resolvePending: async (pending, resolution) => {
        await this.resolvePending(context, pending, resolution);
      },
      terminate: async () => {
        await context.emit({
          type: 'terminal.output',
          source: { adapterId: this.id, vendorEventType: 'fake.terminate' },
          data: { stream: 'stdout', chunk: 'Fake adapter terminated\n' },
        });
      },
    };
  }

  async resumeSession(input: AdapterResumeInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    return this.createSession({
      agentId: input.session.agentId,
      cwd: input.session.cwd,
      title: input.session.title,
      initialPrompt: 'Recovered fake session.',
      mode: input.session.mode,
      executionPolicy: input.session.executionPolicy,
      extraDirectories: [],
      adapterOptions: {},
    }, context);
  }

  private async handleMessage(text: string, context: AdapterCreateContext): Promise<void> {
    const normalized = text.toLowerCase();
    if (normalized.includes('approval')) {
      const pending = this.makePending(context.session.id, 'approval', 'Allow the fake adapter to continue?');
      await context.emit({ type: 'approval.requested', source: { adapterId: this.id, vendorEventType: 'fake.approval' }, data: { pendingAction: pending } });
      return;
    }

    if (normalized.includes('question')) {
      const pending = this.makePending(context.session.id, 'question', 'What answer should the fake adapter use?');
      await context.emit({ type: 'question.requested', source: { adapterId: this.id, vendorEventType: 'fake.question' }, data: { pendingAction: pending } });
      return;
    }

    if (normalized.includes('plan')) {
      const pending = this.makePending(context.session.id, 'plan', 'Accept the fake adapter plan?');
      await context.emit({
        type: 'plan.requested',
        source: { adapterId: this.id, vendorEventType: 'fake.plan' },
        data: { pendingAction: pending, planPreview: '1. Inspect the repo. 2. Propose changes. 3. Wait for approval.' },
      });
      return;
    }

    if (normalized.includes('terminal')) {
      await context.emit({
        type: 'terminal.output',
        source: { adapterId: this.id, vendorEventType: 'fake.terminal' },
        data: { stream: 'stdout', chunk: 'running fake terminal task\n' },
      });
    }

    await this.emitAssistant(context, 'Fake adapter is thinking…', `Fake response: ${text}`);
  }

  private async resolvePending(context: AdapterCreateContext, pending: PendingAction, resolution: PendingResolution): Promise<void> {
    const result = resolution.text ? `Resolved ${pending.type} with: ${resolution.text}` : `Resolved ${pending.type} with option ${resolution.optionId}`;
    await this.emitAssistant(context, `Continuing after ${pending.type}.`, result);
  }

  private makePending(sessionId: string, type: PendingAction['type'], prompt: string): PendingAction {
    const baseOptions = type === 'question'
      ? [{ id: 'submit', label: 'Submit', kind: 'submit' as const }, { id: 'cancel', label: 'Cancel', kind: 'cancel' as const }]
      : [{ id: 'allow', label: 'Allow', kind: 'allow' as const }, { id: 'deny', label: 'Deny', kind: 'deny' as const }];

    return {
      id: createId('pa'),
      sessionId,
      type,
      status: 'open',
      prompt,
      options: baseOptions,
      defaultOptionId: baseOptions[0]?.id,
      createdAt: new Date().toISOString(),
      vendorPayload: { adapterId: this.id },
    };
  }

  private async emitAssistant(context: AdapterCreateContext, delta: string, finalText: string): Promise<void> {
    await context.emit({ type: 'assistant.delta', source: { adapterId: this.id, vendorEventType: 'fake.delta' }, data: { channel: 'commentary', textDelta: delta } });
    await delayed(40);
    await context.emit({ type: 'assistant.final', source: { adapterId: this.id, vendorEventType: 'fake.final' }, data: { channel: 'final', text: finalText } });
  }
}
