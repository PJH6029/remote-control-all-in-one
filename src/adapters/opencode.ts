import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

import { type AdapterCapability, type AdapterProbeResult, type CreateSessionInput, type ExecutionPolicy, type PendingAction } from '../shared/contracts';
import { ApiError } from '../shared/errors';
import type { AgentAdapter, AdapterCreateContext, AdapterResumeInput, AdapterSessionHandle, PendingResolution } from './base';

const execFileAsync = promisify(execFile);

function opencodePrompt(mode: 'build' | 'plan', prompt: string): string {
  if (mode === 'build') return prompt;
  return `Reply to the user in plan mode only. Do not modify files.\n\n${prompt}`;
}

async function probeOpenCodeBinary(): Promise<AdapterProbeResult> {
  try {
    const { stdout } = await execFileAsync('which', ['opencode']);
    const binaryPath = stdout.trim() || null;
    const version = binaryPath ? (await execFileAsync('opencode', ['--version']).catch(() => ({ stdout: '' }))).stdout.trim() || null : null;
    return {
      agentId: 'opencode',
      installed: Boolean(binaryPath),
      binaryPath,
      version,
      authenticated: null,
      tmuxAvailable: false,
      status: binaryPath ? 'healthy' : 'blocked',
      summary: binaryPath ? 'OpenCode CLI is installed.' : 'OpenCode CLI is not installed.',
      details: binaryPath ? ['Uses headless opencode run JSON transport in this product.'] : ['Install OpenCode to enable this adapter.'],
    };
  } catch {
    return {
      agentId: 'opencode',
      installed: false,
      binaryPath: null,
      version: null,
      authenticated: null,
      tmuxAvailable: false,
      status: 'blocked',
      summary: 'OpenCode CLI is not installed.',
      details: ['Install OpenCode to enable this adapter.'],
    };
  }
}

class OpenCodeSessionHandle implements AdapterSessionHandle {
  private sessionId: string | undefined;
  private child: ChildProcess | undefined;
  private mode: 'build' | 'plan';
  private executionPolicy: ExecutionPolicy;
  private readonly extraDirectories = new Set<string>();

  constructor(private readonly context: AdapterCreateContext, input?: CreateSessionInput) {
    this.sessionId = context.session.adapterState?.vendorSessionId as string | undefined;
    this.mode = context.session.mode;
    this.executionPolicy = context.session.executionPolicy;
    for (const dir of input?.extraDirectories ?? []) this.extraDirectories.add(dir);
  }

  private async waitForExistingTurn(): Promise<void> {
    if (!this.child) return;
    await new Promise<void>((resolve) => {
      const current = this.child;
      const done = () => resolve();
      current?.once('close', done);
      current?.once('error', done);
      setTimeout(done, 1500);
    });
  }

  async start(prompt: string, resume = false): Promise<void> {
    if (this.child) await this.waitForExistingTurn();
    if (this.child) throw new ApiError(409, 'conflict', 'OpenCode session is already running.');
    const effectivePrompt = opencodePrompt(this.mode, prompt);
    const args = ['run', '--format', 'json', '--dir', this.context.session.cwd, '--agent', this.mode === 'plan' ? 'plan' : 'build'];
    if (resume && this.sessionId) args.push('--session', this.sessionId);
    args.push(effectivePrompt);

    const child = spawn('opencode', args, {
      cwd: this.context.session.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.stdout || !child.stderr) throw new Error('OpenCode process streams are unavailable.');
    this.child = child;

    const assistantParts: string[] = [];
    const stdout = createInterface({ input: child.stdout });
    stdout.on('line', (line) => {
      void this.handleStdoutLine(line, assistantParts);
    });
    const stderr = createInterface({ input: child.stderr });
    stderr.on('line', (line) => {
      void this.context.emit({
        type: 'terminal.output',
        source: { adapterId: 'opencode', vendorEventType: 'stderr' },
        data: { stream: 'stderr', chunk: `${line}\n` },
      });
    });

    child.on('close', (code) => {
      if (code && code !== 0) {
        void this.context.emit({
          type: 'session.error',
          source: { adapterId: 'opencode', vendorEventType: 'process.exit' },
          data: { code: 'adapter_launch_failed', message: `OpenCode exited with code ${code}.`, recoverable: true },
        });
      }
      this.child = undefined;
    });
    child.on('error', (error) => {
      void this.context.emit({
        type: 'session.error',
        source: { adapterId: 'opencode', vendorEventType: 'spawn.error' },
        data: { code: 'adapter_launch_failed', message: error.message, recoverable: true },
      });
      this.child = undefined;
    });
  }

  private async handleStdoutLine(line: string, assistantParts: string[]): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      await this.context.emit({
        type: 'terminal.output',
        source: { adapterId: 'opencode', vendorEventType: 'stdout.raw' },
        data: { stream: 'stdout', chunk: `${line}\n` },
      });
      return;
    }

    if (parsed.sessionID && parsed.sessionID !== this.sessionId) {
      this.sessionId = parsed.sessionID;
      await this.context.emit({
        type: 'session.updated',
        source: { adapterId: 'opencode', vendorEventType: parsed.type ?? 'session' },
        data: { adapterState: { vendorSessionId: this.sessionId } },
      });
    }

    if (parsed.type === 'text' && parsed.part?.text) {
      assistantParts.push(parsed.part.text);
      await this.context.emit({
        type: 'assistant.delta',
        source: { adapterId: 'opencode', vendorEventType: 'text' },
        data: { channel: 'commentary', textDelta: parsed.part.text },
      });
      return;
    }

    if (parsed.type === 'tool_use' && parsed.part?.tool) {
      await this.context.emit({
        type: 'terminal.output',
        source: { adapterId: 'opencode', vendorEventType: 'tool_use' },
        data: {
          stream: 'stdout',
          chunk: `[tool:${parsed.part.tool}] ${JSON.stringify(parsed.part.state?.input ?? {})}\n${parsed.part.state?.output ?? ''}`,
        },
      });
      return;
    }

    if (parsed.type === 'step_finish' && parsed.part?.reason === 'stop' && assistantParts.length) {
      await this.context.emit({
        type: 'assistant.final',
        source: { adapterId: 'opencode', vendorEventType: 'step_finish' },
        data: { channel: 'final', text: assistantParts.join('\n\n') },
      });
      assistantParts.length = 0;
    }
  }

  async sendMessage(input: { text: string; clientMessageId: string }): Promise<void> {
    await this.start(input.text, Boolean(this.sessionId));
  }

  async setMode(mode: 'build' | 'plan'): Promise<{ restartRequired: boolean }> {
    this.mode = mode;
    return { restartRequired: false };
  }

  async updateExecutionPolicy(executionPolicy: ExecutionPolicy): Promise<{ restartRequired: boolean }> {
    this.executionPolicy = executionPolicy;
    return { restartRequired: false };
  }

  async resolvePending(pending: PendingAction, resolution: PendingResolution): Promise<void> {
    void pending;
    void resolution;
    throw new ApiError(409, 'conflict', 'OpenCode headless transport does not expose structured pending actions in this implementation.');
  }

  async terminate(force = false): Promise<void> {
    if (!this.child) return;
    this.child.kill(force ? 'SIGKILL' : 'SIGTERM');
    this.child = undefined;
  }
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';

  capability(): AdapterCapability {
    return {
      agentId: this.id,
      displayName: this.displayName,
      transport: 'http',
      supportsPlanMode: true,
      supportsModeSwitch: true,
      supportsExecutionPolicySwitch: true,
      supportsPendingApprovals: false,
      supportsQuestions: false,
      supportsPlanRequests: false,
      supportsTmuxAttach: false,
      supportsStructuredEvents: true,
      supportsResume: true,
      supportsForceTerminate: true,
      supportsLocalBrowserOpen: false,
      planModeImplementation: 'native',
      executionPolicyImplementation: 'limited',
      notes: ['Uses headless opencode run JSON transport.', 'Attach is intentionally disabled for the minimum releasable transport.'],
    };
  }

  probe(): Promise<AdapterProbeResult> {
    return probeOpenCodeBinary();
  }

  async optionSchema(): Promise<Record<string, unknown>> {
    return {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string', title: 'Model' },
          variant: { type: 'string', title: 'Variant' },
        },
      },
      ui: {},
      defaults: {},
    };
  }

  async createSession(input: CreateSessionInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    const handle = new OpenCodeSessionHandle(context, input);
    void handle.start(input.initialPrompt, false);
    return handle;
  }

  async resumeSession(input: AdapterResumeInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    return new OpenCodeSessionHandle({ ...context, session: input.session });
  }
}
