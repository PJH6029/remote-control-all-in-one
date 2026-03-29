import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';

import { createId } from '../shared/ids';
import { type AdapterCapability, type AdapterProbeResult, type CreateSessionInput, type ExecutionPolicy, type PendingAction } from '../shared/contracts';
import { ApiError } from '../shared/errors';
import type { AgentAdapter, AdapterCreateContext, AdapterResumeInput, AdapterSessionHandle, PendingResolution } from './base';

const execFileAsync = promisify(execFile);

function claudePrompt(mode: 'build' | 'plan', prompt: string): string {
  if (mode === 'build') return prompt;
  return [
    'You are in plan mode.',
    'Analyze and propose steps only.',
    'Do not modify files until the user returns to build mode.',
    '',
    prompt,
  ].join('\n');
}

function permissionMode(mode: 'build' | 'plan', policy: ExecutionPolicy, override = false): string {
  if (mode === 'plan') return 'plan';
  if (override) return 'acceptEdits';
  return policy.approvals === 'never' ? 'acceptEdits' : 'default';
}

async function probeClaudeBinary(): Promise<AdapterProbeResult> {
  try {
    const { stdout } = await execFileAsync('which', ['claude']);
    const binaryPath = stdout.trim() || null;
    const version = binaryPath ? (await execFileAsync('claude', ['--version']).catch(() => ({ stdout: '' }))).stdout.trim() || null : null;
    return {
      agentId: 'claude',
      installed: Boolean(binaryPath),
      binaryPath,
      version,
      authenticated: null,
      tmuxAvailable: false,
      status: binaryPath ? 'healthy' : 'blocked',
      summary: binaryPath ? 'Claude Code CLI is installed.' : 'Claude Code CLI is not installed.',
      details: binaryPath ? ['Uses headless print + stream-json transport in this product.'] : ['Install the Claude Code CLI to enable this adapter.'],
    };
  } catch {
    return {
      agentId: 'claude',
      installed: false,
      binaryPath: null,
      version: null,
      authenticated: null,
      tmuxAvailable: false,
      status: 'blocked',
      summary: 'Claude Code CLI is not installed.',
      details: ['Install the Claude Code CLI to enable this adapter.'],
    };
  }
}

class ClaudeSessionHandle implements AdapterSessionHandle {
  private sessionId: string | undefined;
  private child: ChildProcess | undefined;
  private mode: 'build' | 'plan';
  private executionPolicy: ExecutionPolicy;
  private readonly extraDirectories = new Set<string>();
  private readonly resumePrompts = new Map<string, string>();

  constructor(private readonly context: AdapterCreateContext, input?: CreateSessionInput) {
    this.sessionId = this.context.session.adapterState?.vendorSessionId as string | undefined;
    this.mode = this.context.session.mode;
    this.executionPolicy = this.context.session.executionPolicy;
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

  async start(prompt: string, resume = false, overridePermissions = false): Promise<void> {
    if (this.child) await this.waitForExistingTurn();
    if (this.child) throw new ApiError(409, 'conflict', 'Claude session is already running.');
    const effectivePrompt = claudePrompt(this.mode, prompt);
    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--permission-mode', permissionMode(this.mode, this.executionPolicy, overridePermissions),
    ];
    for (const dir of [...this.executionPolicy.writableRoots, ...this.extraDirectories]) {
      args.push('--add-dir', dir);
    }
    if (resume && this.sessionId) {
      args.push('-r', this.sessionId);
    }
    args.push(effectivePrompt);

    const child = spawn('claude', args, {
      cwd: this.context.session.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.stdout || !child.stderr) throw new Error('Claude process streams are unavailable.');
    this.child = child;

    const stdout = createInterface({ input: child.stdout });
    stdout.on('line', (line) => {
      void this.handleStdoutLine(line, effectivePrompt);
    });
    const stderr = createInterface({ input: child.stderr });
    stderr.on('line', (line) => {
      void this.context.emit({
        type: 'terminal.output',
        source: { adapterId: 'claude', vendorEventType: 'stderr' },
        data: { stream: 'stderr', chunk: `${line}\n` },
      });
    });

    child.on('close', (code) => {
      if (code && code !== 0) {
        void this.context.emit({
          type: 'session.error',
          source: { adapterId: 'claude', vendorEventType: 'process.exit' },
          data: { code: 'adapter_launch_failed', message: `Claude exited with code ${code}.`, recoverable: true },
        });
      }
      this.child = undefined;
    });
    child.on('error', (error) => {
      void this.context.emit({
        type: 'session.error',
        source: { adapterId: 'claude', vendorEventType: 'spawn.error' },
        data: { code: 'adapter_launch_failed', message: error.message, recoverable: true },
      });
      this.child = undefined;
    });
  }

  private async handleStdoutLine(line: string, originalPrompt: string): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      await this.context.emit({
        type: 'terminal.output',
        source: { adapterId: 'claude', vendorEventType: 'stdout.raw' },
        data: { stream: 'stdout', chunk: `${line}\n` },
      });
      return;
    }

    if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
      this.sessionId = parsed.session_id;
      await this.context.emit({
        type: 'session.updated',
        source: { adapterId: 'claude', vendorEventType: 'system.init' },
        data: { adapterState: { vendorSessionId: this.sessionId } },
      });
      return;
    }

    if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
      for (const content of parsed.message.content) {
        if (content.type === 'text' && content.text) {
          await this.context.emit({
            type: 'assistant.delta',
            source: { adapterId: 'claude', vendorEventType: 'assistant.text' },
            data: { channel: 'commentary', textDelta: content.text },
          });
        }
        if (content.type === 'tool_use') {
          await this.context.emit({
            type: 'terminal.output',
            source: { adapterId: 'claude', vendorEventType: 'tool_use' },
            data: { stream: 'stdout', chunk: `[tool:${content.name}] ${JSON.stringify(content.input ?? {})}\n` },
          });
        }
      }
      return;
    }

    if (parsed.type === 'result') {
      if (typeof parsed.result === 'string' && parsed.result) {
        await this.context.emit({
          type: 'assistant.final',
          source: { adapterId: 'claude', vendorEventType: parsed.subtype ?? 'result' },
          data: { channel: 'final', text: parsed.result },
        });
      }
      if (Array.isArray(parsed.permission_denials) && parsed.permission_denials.length) {
        const denial = parsed.permission_denials[0];
        const pendingId = createId('pa');
        this.resumePrompts.set(pendingId, 'Permission granted. Continue and complete the previously denied operation.');
        await this.context.emit({
          type: 'approval.requested',
          source: { adapterId: 'claude', vendorEventType: 'permission_denied' },
          data: {
            pendingAction: {
              id: pendingId,
              sessionId: this.context.session.id,
              type: 'approval',
              status: 'open',
              prompt: `Allow Claude to continue the previously denied ${denial.tool_name ?? 'tool'} action?`,
              options: [
                { id: 'allow', label: 'Allow', kind: 'allow' },
                { id: 'deny', label: 'Deny', kind: 'deny' },
              ],
              defaultOptionId: 'allow',
              createdAt: new Date().toISOString(),
              vendorPayload: { denial, originalPrompt },
            },
          },
        });
      }
    }
  }

  async sendMessage(input: { text: string; clientMessageId: string }): Promise<void> {
    await this.start(input.text, Boolean(this.sessionId), false);
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
    if (pending.type !== 'approval') {
      throw new ApiError(409, 'conflict', 'Claude headless transport only supports approval resolution in this implementation.');
    }
    if (resolution.optionId !== 'allow') return;
    const resumePrompt = this.resumePrompts.get(pending.id) ?? 'Permission granted. Continue.';
    this.resumePrompts.delete(pending.id);
    await this.start(resumePrompt, true, true);
  }

  async terminate(force = false): Promise<void> {
    if (!this.child) return;
    this.child.kill(force ? 'SIGKILL' : 'SIGTERM');
    this.child = undefined;
  }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';

  capability(): AdapterCapability {
    return {
      agentId: this.id,
      displayName: this.displayName,
      transport: 'pty',
      supportsPlanMode: true,
      supportsModeSwitch: true,
      supportsExecutionPolicySwitch: true,
      supportsPendingApprovals: true,
      supportsQuestions: false,
      supportsPlanRequests: false,
      supportsTmuxAttach: false,
      supportsStructuredEvents: true,
      supportsResume: true,
      supportsForceTerminate: true,
      supportsLocalBrowserOpen: false,
      planModeImplementation: 'native',
      executionPolicyImplementation: 'limited',
      notes: ['Uses headless claude print + stream-json transport.', 'Attach is intentionally disabled for the minimum releasable transport.'],
    };
  }

  probe(): Promise<AdapterProbeResult> {
    return probeClaudeBinary();
  }

  async optionSchema(): Promise<Record<string, unknown>> {
    return {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string', title: 'Model' },
          effort: { type: 'string', enum: ['low', 'medium', 'high', 'max'], title: 'Effort' },
        },
      },
      ui: {},
      defaults: {},
    };
  }

  async createSession(input: CreateSessionInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    const handle = new ClaudeSessionHandle(context, input);
    void handle.start(input.initialPrompt, false, false);
    return handle;
  }

  async resumeSession(input: AdapterResumeInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    return new ClaudeSessionHandle({ ...context, session: input.session });
  }
}
