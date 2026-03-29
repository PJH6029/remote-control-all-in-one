import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

import { type AdapterCapability, type AdapterProbeResult, type CreateSessionInput, type ExecutionPolicy, type PendingAction } from '../shared/contracts';
import { ApiError } from '../shared/errors';
import type { AgentAdapter, AdapterCreateContext, AdapterResumeInput, AdapterSessionHandle, PendingResolution } from './base';

const execFileAsync = promisify(execFile);

function codexPrompt(mode: 'build' | 'plan', prompt: string): string {
  if (mode === 'build') return prompt;
  return [
    'You are in plan mode.',
    'Inspect and analyze only.',
    'Do not modify files or run write-like commands.',
    'Respond with the plan, findings, and tradeoffs.',
    '',
    prompt,
  ].join('\n');
}

function sandboxModeForPolicy(policy: ExecutionPolicy): string {
  return policy.filesystem;
}

function configArgs(policy: ExecutionPolicy): string[] {
  const args = [
    '-c', `approval_policy=${JSON.stringify(policy.approvals)}`,
    '-c', `sandbox_mode=${JSON.stringify(sandboxModeForPolicy(policy))}`,
  ];
  if (policy.filesystem === 'workspace-write') {
    args.push('-c', `sandbox_workspace_write.network_access=${policy.network === 'on' ? 'true' : 'false'}`);
    if (policy.writableRoots.length) {
      args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(policy.writableRoots)}`);
    }
  }
  return args;
}

async function probeCodexBinary(): Promise<AdapterProbeResult> {
  try {
    const { stdout } = await execFileAsync('which', ['codex']);
    const which = stdout.trim() || null;
    if (!which) {
      return {
        agentId: 'codex',
        installed: false,
        binaryPath: null,
        version: null,
        authenticated: null,
        tmuxAvailable: false,
        status: 'blocked',
        summary: 'Codex CLI is not installed.',
        details: ['Install the Codex CLI to enable this adapter.'],
      };
    }
    const version = (await execFileAsync('codex', ['--version']).catch(() => ({ stdout: '' }))).stdout.trim() || null;
    return {
      agentId: 'codex',
      installed: true,
      binaryPath: which,
      version,
      authenticated: null,
      tmuxAvailable: false,
      status: 'healthy',
      summary: 'Codex CLI is installed.',
      details: ['Uses headless exec/resume JSON transport in this product.'],
    };
  } catch {
    return {
      agentId: 'codex',
      installed: false,
      binaryPath: null,
      version: null,
      authenticated: null,
      tmuxAvailable: false,
      status: 'blocked',
      summary: 'Codex CLI is not installed.',
      details: ['Install the Codex CLI to enable this adapter.'],
    };
  }
}

class CodexSessionHandle implements AdapterSessionHandle {
  private threadId: string | undefined;
  private child: ChildProcess | undefined;
  private lastPrompt = '';
  private mode: 'build' | 'plan';
  private executionPolicy: ExecutionPolicy;
  private readonly extraDirectories = new Set<string>();

  constructor(private readonly context: AdapterCreateContext, input?: CreateSessionInput) {
    this.threadId = this.context.session.adapterState?.vendorSessionId as string | undefined;
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

  async start(prompt: string, resume = false): Promise<void> {
    if (this.child) await this.waitForExistingTurn();
    if (this.child) throw new ApiError(409, 'conflict', 'Codex session is already running.');
    this.lastPrompt = prompt;
    const effectivePrompt = codexPrompt(this.mode, prompt);
    const args = resume && this.threadId
      ? ['exec', 'resume', '--json', ...configArgs(this.executionPolicy), '--skip-git-repo-check', this.threadId, effectivePrompt]
      : ['exec', '--json', ...configArgs(this.executionPolicy), '--skip-git-repo-check', '-C', this.context.session.cwd, effectivePrompt];
    if (!resume) {
      for (const dir of [...this.executionPolicy.writableRoots, ...this.extraDirectories]) {
        args.splice(args.length - 1, 0, '--add-dir', dir);
      }
    }

    const child = spawn('codex', args, {
      cwd: this.context.session.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.stdout || !child.stderr) throw new Error('Codex process streams are unavailable.');
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
        source: { adapterId: 'codex', vendorEventType: 'stderr' },
        data: { stream: 'stderr', chunk: `${line}\n` },
      });
    });

    child.on('close', (code) => {
      void (async () => {
        this.child = undefined;
        if (assistantParts.length) {
          await this.context.emit({
            type: 'assistant.final',
            source: { adapterId: 'codex', vendorEventType: 'turn.completed' },
            data: { channel: 'final', text: assistantParts.join('\n\n') },
          });
        }
        if (code && code !== 0) {
          await this.context.emit({
            type: 'session.error',
            source: { adapterId: 'codex', vendorEventType: 'process.exit' },
            data: { code: 'adapter_launch_failed', message: `Codex exited with code ${code}.`, recoverable: true },
          });
        }
      })();
    });
    child.on('error', (error) => {
      void this.context.emit({
        type: 'session.error',
        source: { adapterId: 'codex', vendorEventType: 'spawn.error' },
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
        source: { adapterId: 'codex', vendorEventType: 'stdout.raw' },
        data: { stream: 'stdout', chunk: `${line}\n` },
      });
      return;
    }

    if (parsed.type === 'thread.started' && parsed.thread_id) {
      this.threadId = parsed.thread_id;
      await this.context.emit({
        type: 'session.updated',
        source: { adapterId: 'codex', vendorEventType: 'thread.started' },
        data: { adapterState: { vendorSessionId: this.threadId } },
      });
      return;
    }

    if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message' && parsed.item.text) {
      assistantParts.push(parsed.item.text);
      await this.context.emit({
        type: 'assistant.delta',
        source: { adapterId: 'codex', vendorEventType: 'agent_message' },
        data: { channel: 'commentary', textDelta: parsed.item.text },
      });
      return;
    }

    if ((parsed.type === 'item.started' || parsed.type === 'item.completed') && parsed.item?.type === 'command_execution') {
      const chunk = parsed.item.aggregated_output
        ? `${parsed.item.command}\n${parsed.item.aggregated_output}`
        : `${parsed.item.command}\n`;
      await this.context.emit({
        type: 'terminal.output',
        source: { adapterId: 'codex', vendorEventType: parsed.type },
        data: { stream: 'stdout', chunk },
      });
    }
  }

  async sendMessage(input: { text: string; clientMessageId: string }): Promise<void> {
    await this.start(input.text, Boolean(this.threadId));
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
    throw new ApiError(409, 'conflict', 'Codex headless transport does not expose structured pending actions in this implementation.');
  }

  async terminate(force = false): Promise<void> {
    if (!this.child) return;
    this.child.kill(force ? 'SIGKILL' : 'SIGTERM');
    this.child = undefined;
  }
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';

  capability(): AdapterCapability {
    return {
      agentId: this.id,
      displayName: this.displayName,
      transport: 'pty',
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
      planModeImplementation: 'emulated',
      executionPolicyImplementation: 'limited',
      notes: ['Uses headless codex exec/resume JSON transport.', 'Attach is intentionally disabled for the minimum releasable transport.'],
    };
  }

  probe(): Promise<AdapterProbeResult> {
    return probeCodexBinary();
  }

  async optionSchema(): Promise<Record<string, unknown>> {
    return {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string', title: 'Model' },
        },
      },
      ui: {},
      defaults: {},
    };
  }

  async createSession(input: CreateSessionInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    const handle = new CodexSessionHandle(context, input);
    void handle.start(input.initialPrompt, false);
    return handle;
  }

  async resumeSession(input: AdapterResumeInput, context: AdapterCreateContext): Promise<AdapterSessionHandle> {
    return new CodexSessionHandle({ ...context, session: input.session });
  }
}
