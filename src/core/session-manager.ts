import type { AgentAdapter, AdapterSessionHandle } from '../adapters/base';
import { FakeAdapter } from '../adapters/fake';
import { createBuiltInAdapters } from '../adapters/probes';
import { stat } from 'node:fs/promises';
import {
  createSessionSchema,
  executionPolicySchema,
  type AppConfig,
  type CreateSessionInput,
  type ExecutionPolicy,
  type SessionDetail,
  type SessionEvent,
  type SessionSummary,
} from '../shared/contracts';
import { ApiError } from '../shared/errors';
import { createId } from '../shared/ids';
import { appendDaemonLog, appendSessionLog, readEvents, listSnapshots, writeActiveSessions, writeSnapshot, appendEvent } from './event-store';
import { applySessionEvent, toSessionSummary } from './session-reducer';
import type { StoragePaths } from './storage';

interface RuntimeSession {
  detail: SessionDetail;
  adapter: AgentAdapter;
  handle?: AdapterSessionHandle;
}

type Subscriber = (event: SessionEvent) => void;

class EventBus {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(listener: Subscriber): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  publish(event: SessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

function deriveTitle(initialPrompt: string): string {
  return initialPrompt.trim().slice(0, 72) || 'Untitled session';
}

async function assertDirectoryExists(directoryPath: string, label: string): Promise<void> {
  let details;
  try {
    details = await stat(directoryPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ApiError(400, 'validation_failed', `${label} does not exist: ${directoryPath}`);
    }
    throw error;
  }
  if (!details.isDirectory()) {
    throw new ApiError(400, 'validation_failed', `${label} is not a directory: ${directoryPath}`);
  }
}

export class SessionManager {
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly bus = new EventBus();
  private readonly mutationQueues = new Map<string, Promise<unknown>>();
  private readonly eventQueues = new Map<string, Promise<void>>();
  private readonly createIdempotency = new Map<string, string>();

  constructor(private readonly config: AppConfig, private readonly paths: StoragePaths) {
    const allAdapters = [new FakeAdapter(), ...createBuiltInAdapters({
      codex: this.config.agents.codex,
      claude: this.config.agents.claude,
      opencode: this.config.agents.opencode,
    })];
    for (const adapter of allAdapters) this.adapters.set(adapter.id, adapter);
  }

  async initialize(): Promise<void> {
    const snapshots = await listSnapshots(this.paths);
    for (const snapshot of snapshots) {
      const adapter = this.getAdapter(snapshot.agentId);
      this.sessions.set(snapshot.id, { detail: snapshot, adapter });
    }

    for (const snapshot of snapshots) {
      if (snapshot.status === 'terminated') continue;
      const runtime = this.sessions.get(snapshot.id);
      if (!runtime) continue;
      try {
        runtime.handle = await runtime.adapter.resumeSession({ session: runtime.detail }, {
          session: runtime.detail,
          emit: async (event) => {
            await this.recordEvent(runtime.detail.id, event);
          },
        });
        this.sessions.set(runtime.detail.id, runtime);
        if (['starting', 'running', 'restarting', 'terminating'].includes(runtime.detail.status)) {
          await this.recordEvent(runtime.detail.id, {
            type: 'session.updated',
            source: { adapterId: runtime.adapter.id, vendorEventType: 'session.reconciled' },
            data: { status: 'idle', reason: 'Recovered after daemon restart.' },
          });
        }
      } catch (error) {
        await this.recordEvent(runtime.detail.id, {
          type: 'session.error',
          source: { adapterId: runtime.adapter.id, vendorEventType: 'session.resume.error' },
          data: {
            code: 'resume_failed',
            message: error instanceof Error ? error.message : 'Failed to resume session.',
            recoverable: true,
            actionHint: 'Review doctor output and send a follow-up prompt to continue.',
          },
        });
      }
    }

    await this.syncActiveSessions();
  }

  listAdapters(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  subscribe(listener: Subscriber): () => void {
    return this.bus.subscribe(listener);
  }

  async listSessions(): Promise<SessionSummary[]> {
    return [...this.sessions.values()].map(({ detail }) => toSessionSummary(detail)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getSession(sessionId: string): SessionDetail {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ApiError(404, 'session_not_found', 'Session was not found.');
    return session.detail;
  }

  async getEvents(sessionId: string, afterSequence = 0, limit = this.config.ui.eventPageSize): Promise<SessionEvent[]> {
    return readEvents(this.paths, sessionId, afterSequence, limit);
  }

  async createSession(input: CreateSessionInput, idempotencyKey?: string): Promise<SessionDetail> {
    const parsed = createSessionSchema.parse(input);
    await assertDirectoryExists(parsed.cwd, 'Working directory');
    await Promise.all(parsed.extraDirectories.map((directory) => assertDirectoryExists(directory, 'Extra writable directory')));
    if (idempotencyKey) {
      const existingId = this.createIdempotency.get(idempotencyKey);
      if (existingId && this.sessions.has(existingId)) {
        return this.getSession(existingId);
      }
    }

    const adapter = this.getAdapter(parsed.agentId);
    const now = new Date().toISOString();
    const detail: SessionDetail = {
      id: createId('ses'),
      title: parsed.title || deriveTitle(parsed.initialPrompt),
      agentId: parsed.agentId,
      status: 'starting',
      mode: parsed.mode,
      cwd: parsed.cwd,
      hasPendingActions: false,
      executionPolicy: executionPolicySchema.parse(parsed.executionPolicy),
      capabilities: adapter.capability(),
      pendingActions: [],
      createdAt: now,
      updatedAt: now,
      lastSequence: 0,
      adapterState: {},
    };

    this.sessions.set(detail.id, { detail, adapter });
    await writeSnapshot(this.paths, detail);
    await this.syncActiveSessions();
    if (idempotencyKey) this.createIdempotency.set(idempotencyKey, detail.id);

    await this.recordEvent(detail.id, {
      type: 'session.started',
      source: { adapterId: adapter.id, vendorEventType: 'session.started' },
      data: { cwd: detail.cwd },
    });
    await this.recordEvent(detail.id, {
      type: 'user.sent',
      source: { adapterId: adapter.id, vendorEventType: 'user.initial' },
      data: { text: parsed.initialPrompt, clientMessageId: createId('msg') },
    });

    try {
      const handle = await adapter.createSession(parsed, {
        session: this.getSession(detail.id),
        emit: async (event) => {
          await this.recordEvent(detail.id, event);
        },
      });
      this.sessions.get(detail.id)!.handle = handle;
      return this.getSession(detail.id);
    } catch (error) {
      await this.recordEvent(detail.id, {
        type: 'session.error',
        source: { adapterId: adapter.id, vendorEventType: 'adapter.create.error' },
        data: { code: 'adapter_launch_failed', message: error instanceof Error ? error.message : 'Failed to create session.', recoverable: true, actionHint: 'Review doctor output and retry.' },
      });
      throw error;
    }
  }

  async sendMessage(sessionId: string, input: { text: string; clientMessageId: string }): Promise<SessionDetail> {
    return this.withSessionMutation(sessionId, async () => {
      const session = this.requireRuntimeSession(sessionId);
      const existing = (await this.getEvents(sessionId, 0, 10_000)).find((event) => event.type === 'user.sent' && event.data.clientMessageId === input.clientMessageId);
      if (existing) return this.getSession(sessionId);
      await this.recordEvent(sessionId, { type: 'user.sent', source: { adapterId: session.adapter.id, vendorEventType: 'user.sent' }, data: input });
      await session.handle!.sendMessage(input);
      return this.getSession(sessionId);
    });
  }

  async updateMode(sessionId: string, mode: 'build' | 'plan'): Promise<{ mode: 'build' | 'plan'; restartRequired: boolean }> {
    return this.withSessionMutation(sessionId, async () => {
      const session = this.requireRuntimeSession(sessionId);
      const result = await session.handle!.setMode(mode);
      await this.recordEvent(sessionId, {
        type: 'session.updated',
        source: { adapterId: session.adapter.id, vendorEventType: 'mode.updated' },
        data: { mode, restartRequired: result.restartRequired, status: result.restartRequired ? 'restarting' : 'idle' },
      });
      return { mode, restartRequired: result.restartRequired };
    });
  }

  async updatePolicy(sessionId: string, executionPolicy: ExecutionPolicy): Promise<{ executionPolicy: ExecutionPolicy; restartRequired: boolean }> {
    return this.withSessionMutation(sessionId, async () => {
      const session = this.requireRuntimeSession(sessionId);
      const normalized = executionPolicySchema.parse(executionPolicy);
      const result = await session.handle!.updateExecutionPolicy(normalized);
      await this.recordEvent(sessionId, {
        type: 'session.updated',
        source: { adapterId: session.adapter.id, vendorEventType: 'policy.updated' },
        data: { executionPolicy: normalized, restartRequired: result.restartRequired },
      });
      return { executionPolicy: normalized, restartRequired: result.restartRequired };
    });
  }

  async resolvePending(sessionId: string, pendingId: string, resolution: { optionId: string; text?: string }): Promise<void> {
    await this.withSessionMutation(sessionId, async () => {
      const session = this.requireRuntimeSession(sessionId);
      const pending = session.detail.pendingActions.find((item) => item.id === pendingId && item.status === 'open');
      if (!pending) throw new ApiError(404, 'pending_action_not_found', 'Pending action was not found.');
      const eventType = pending.type === 'approval' ? 'approval.resolved' : pending.type === 'question' ? 'question.resolved' : 'plan.resolved';
      await this.recordEvent(sessionId, {
        type: eventType,
        source: { adapterId: session.adapter.id, vendorEventType: 'pending.resolved' },
        data: { pendingId, resolution },
      });
      await session.handle!.resolvePending(pending, resolution);
    });
  }

  async terminate(sessionId: string, force = false): Promise<void> {
    await this.withSessionMutation(sessionId, async () => {
      const session = this.requireRuntimeSession(sessionId);
      await session.handle!.terminate(force);
      await this.recordEvent(sessionId, {
        type: 'session.terminated',
        source: { adapterId: session.adapter.id, vendorEventType: 'session.terminated' },
        data: { force },
      });
      delete session.handle;
    });
  }

  private getAdapter(agentId: string): AgentAdapter {
    const adapter = this.adapters.get(agentId);
    if (!adapter) throw new ApiError(409, 'adapter_not_available', `Adapter ${agentId} is not available.`);
    return adapter;
  }

  private requireRuntimeSession(sessionId: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new ApiError(404, 'session_not_found', 'Session was not found.');
    if (!session.handle) throw new ApiError(409, 'conflict', 'Session runtime is not active for this action.');
    return session;
  }

  private async withSessionMutation<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.mutationQueues.set(sessionId, current.then(() => undefined, () => undefined));
    return current;
  }

  private async recordEvent(sessionId: string, event: Omit<SessionEvent, 'id' | 'sessionId' | 'sequence' | 'createdAt'>): Promise<SessionEvent> {
    const previous = this.eventQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.eventQueues.set(sessionId, previous.catch(() => undefined).then(() => gate));
    await previous.catch(() => undefined);

    try {
      const runtime = this.sessions.get(sessionId);
      if (!runtime) throw new ApiError(404, 'session_not_found', 'Session was not found.');
      const sequence = runtime.detail.lastSequence + 1;
      const stored = await appendEvent(this.paths, {
        sessionId,
        sequence,
        createdAt: new Date().toISOString(),
        ...event,
      });
      runtime.detail = applySessionEvent(runtime.detail, stored);
      this.sessions.set(sessionId, runtime);
      await writeSnapshot(this.paths, runtime.detail);
      await this.syncActiveSessions();
      await appendSessionLog(this.paths, sessionId, stored);
      this.bus.publish(stored);
      await appendDaemonLog(this.paths, { scope: 'session-event', sessionId, type: stored.type });
      return stored;
    } finally {
      release();
    }
  }

  private async syncActiveSessions(): Promise<void> {
    const items = [...this.sessions.values()]
      .map(({ detail }) => detail)
      .filter((detail) => detail.status !== 'terminated')
      .map((detail) => toSessionSummary(detail));
    await writeActiveSessions(this.paths, items);
  }
}
