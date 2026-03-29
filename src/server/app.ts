import { readFile } from 'node:fs/promises';
import path from 'node:path';

import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AgentAdapter } from '../adapters/base';
import { buildDoctorReport } from '../core/doctor';
import { loadConfig, saveConfig } from '../core/config';
import { AuthManager } from '../core/auth';
import { SessionManager } from '../core/session-manager';
import { ensureStoragePaths, getStoragePaths, type StoragePaths } from '../core/storage';
import {
  createSessionSchema,
  errorEnvelope,
  resolvePendingSchema,
  sendMessageSchema,
  successEnvelope,
  type AppConfig,
  type SessionDetail,
} from '../shared/contracts';
import { ApiError } from '../shared/errors';
import { redactValue } from '../shared/redaction';

export interface AppServices {
  app: FastifyInstance;
  auth: AuthManager;
  config: AppConfig;
  paths: StoragePaths;
  sessionManager: SessionManager;
  uptimeStartedAt: number;
}

type ReadinessAgent = {
  probe: Awaited<ReturnType<AgentAdapter['probe']>>;
  capabilities: ReturnType<AgentAdapter['capability']>;
  optionSchema: Awaited<ReturnType<AgentAdapter['optionSchema']>>;
};

type ReadinessSnapshot = {
  agents: ReadinessAgent[];
  doctor: Awaited<ReturnType<typeof buildDoctorReport>>;
};

function mergeSettings(current: AppConfig, patch: Record<string, unknown>): { config: AppConfig; restartRequired: boolean; reasons: string[] } {
  const next = structuredClone(current);
  let restartRequired = false;
  const reasons = new Set<string>();

  if (patch.server && typeof patch.server === 'object') {
    const serverPatch = patch.server as Record<string, unknown>;
    if (typeof serverPatch.host === 'string' && serverPatch.host !== next.server.host) {
      next.server.host = serverPatch.host;
      restartRequired = true;
      reasons.add('server.host');
    }
    if (typeof serverPatch.port === 'number' && serverPatch.port !== next.server.port) {
      next.server.port = serverPatch.port;
      restartRequired = true;
      reasons.add('server.port');
    }
    if (typeof serverPatch.openBrowser === 'boolean') next.server.openBrowser = serverPatch.openBrowser;
    if ((serverPatch.authMode === 'local-session' || serverPatch.authMode === 'password') && serverPatch.authMode !== next.server.authMode) {
      next.server.authMode = serverPatch.authMode;
      restartRequired = true;
      reasons.add('server.authMode');
    }
    if ((typeof serverPatch.passwordHash === 'string' || serverPatch.passwordHash === null) && serverPatch.passwordHash !== next.server.passwordHash) {
      next.server.passwordHash = serverPatch.passwordHash as string | null;
      restartRequired = true;
      reasons.add('server.passwordHash');
    }
  }

  if (patch.ui && typeof patch.ui === 'object') {
    const uiPatch = patch.ui as Record<string, unknown>;
    if (typeof uiPatch.showTerminalMirrorByDefault === 'boolean') next.ui.showTerminalMirrorByDefault = uiPatch.showTerminalMirrorByDefault;
    if (typeof uiPatch.eventPageSize === 'number') next.ui.eventPageSize = uiPatch.eventPageSize;
  }

  if (patch.retention && typeof patch.retention === 'object') {
    const retentionPatch = patch.retention as Record<string, unknown>;
    if (typeof retentionPatch.maxRecentSessions === 'number') next.retention.maxRecentSessions = retentionPatch.maxRecentSessions;
    if (typeof retentionPatch.pruneTerminalLogsAfterDays === 'number') next.retention.pruneTerminalLogsAfterDays = retentionPatch.pruneTerminalLogsAfterDays;
    if (typeof retentionPatch.pruneEventsAfterDays === 'number') next.retention.pruneEventsAfterDays = retentionPatch.pruneEventsAfterDays;
  }

  return { config: next, restartRequired, reasons: [...reasons] };
}

async function sendIndex(reply: any): Promise<void> {
  const html = await readFile(path.join(process.cwd(), 'src/ui/index.html'), 'utf8');
  reply.type('text/html').send(html);
}

export async function createApp(paths = getStoragePaths()): Promise<AppServices> {
  await ensureStoragePaths(paths);
  let config = await loadConfig(paths);
  const auth = new AuthManager(config);
  const sessionManager = new SessionManager(config, paths);
  await sessionManager.initialize();

  const app = Fastify({ logger: false });
  const uptimeStartedAt = Date.now();

  await app.register(cookie, { secret: 'rcaio-dev-secret' });
  await app.register(websocket);

  let readinessPromise: Promise<ReadinessSnapshot> | null = null;
  let readinessCache: { expiresAt: number; data: ReadinessSnapshot } | null = null;

  async function loadReadiness(force = false) {
    const now = Date.now();
    if (!force && readinessCache && readinessCache.expiresAt > now) return readinessCache.data;
    if (!force && readinessPromise) return readinessPromise;

    const adapters = sessionManager.listAdapters();
    readinessPromise = (async () => {
      const agentReports = await Promise.all(adapters.map((adapter) => adapter.probe()));
      const reportById = new Map(agentReports.map((report) => [report.agentId, report]));
      const doctor = await buildDoctorReport(config, adapters, paths, agentReports);
      const agents = await Promise.all(adapters.map(async (adapter) => ({
        probe: reportById.get(adapter.id) ?? await adapter.probe(),
        capabilities: adapter.capability(),
        optionSchema: await adapter.optionSchema(),
      })));
      const data = { agents, doctor };
      readinessCache = { expiresAt: Date.now() + 5_000, data };
      return data;
    })();

    try {
      return await readinessPromise;
    } finally {
      readinessPromise = null;
    }
  }

  app.setErrorHandler((error, _request, reply) => {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, 'internal_error', error instanceof Error ? error.message : 'Internal server error.');
    reply.status(apiError.statusCode).send(errorEnvelope(apiError.code, apiError.message, apiError.details));
  });

  app.get('/', async (_request, reply) => {
    await sendIndex(reply);
  });
  app.get('/ui/app.css', async (_request, reply) => reply.type('text/css').send(await readFile(path.join(process.cwd(), 'src/ui/app.css'), 'utf8')));
  app.get('/ui/app.js', async (_request, reply) => reply.type('application/javascript').send(await readFile(path.join(process.cwd(), 'src/ui/app.js'), 'utf8')));

  app.get('/api/auth/session', async (request, reply) => {
    const data = await auth.getBrowserAuthState(request, reply);
    reply.send(successEnvelope(data));
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as { password?: string };
    if (!body.password) throw new ApiError(400, 'validation_failed', 'Password is required.');
    const data = await auth.login(body.password, reply);
    reply.send(successEnvelope(data));
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const data = await auth.logout(request, reply);
    reply.send(successEnvelope(data));
  });

  app.get('/api/health', async (request, reply) => {
    auth.requireAuth(request, reply);
    reply.send(successEnvelope({
      status: 'ok',
      daemon: {
        pid: process.pid,
        bind: `${config.server.host}:${config.server.port}`,
        cwd: process.cwd(),
        uptimeSeconds: Math.floor((Date.now() - uptimeStartedAt) / 1000),
      },
    }));
  });

  app.get('/api/agents', async (request, reply) => {
    auth.requireAuth(request, reply);
    reply.send(successEnvelope(await loadReadiness()));
  });

  app.get('/api/sessions', async (request, reply) => {
    auth.requireAuth(request, reply);
    const query = request.query as { status?: string; agentId?: string; limit?: string; search?: string };
    let items = await sessionManager.listSessions();
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.agentId) items = items.filter((item) => item.agentId === query.agentId);
    if (query.search) {
      const search = query.search.toLowerCase();
      items = items.filter((item) =>
        item.title.toLowerCase().includes(search)
        || item.cwd.toLowerCase().includes(search)
        || item.agentId.toLowerCase().includes(search),
      );
    }
    const limit = query.limit ? Number(query.limit) : undefined;
    if (limit) items = items.slice(0, limit);
    reply.send(successEnvelope({ items, nextCursor: null }));
  });

  app.post('/api/sessions', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const idempotencyKey = typeof request.headers['x-idempotency-key'] === 'string' ? request.headers['x-idempotency-key'] : undefined;
    const detail = await sessionManager.createSession(createSessionSchema.parse(request.body ?? {}), idempotencyKey);
    reply.send(successEnvelope(detail));
  });

  app.get('/api/sessions/:id', async (request, reply) => {
    auth.requireAuth(request, reply);
    reply.send(successEnvelope(sessionManager.getSession((request.params as { id: string }).id)));
  });

  app.get('/api/sessions/:id/events', async (request, reply) => {
    auth.requireAuth(request, reply);
    const params = request.params as { id: string };
    const query = request.query as { afterSequence?: string; limit?: string };
    const items = await sessionManager.getEvents(params.id, Number(query.afterSequence ?? 0), Number(query.limit ?? config.ui.eventPageSize));
    reply.send(successEnvelope({ items, lastSequence: items.at(-1)?.sequence ?? 0 }));
  });

  app.post('/api/sessions/:id/messages', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const params = request.params as { id: string };
    const detail = await sessionManager.sendMessage(params.id, sendMessageSchema.parse(request.body ?? {}));
    reply.send(successEnvelope(detail));
  });

  app.post('/api/sessions/:id/mode', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const params = request.params as { id: string };
    const body = request.body as { mode?: 'build' | 'plan' };
    if (body.mode !== 'build' && body.mode !== 'plan') throw new ApiError(400, 'validation_failed', 'Mode must be build or plan.');
    reply.send(successEnvelope(await sessionManager.updateMode(params.id, body.mode)));
  });

  app.post('/api/sessions/:id/policy', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const params = request.params as { id: string };
    const body = request.body as { executionPolicy?: SessionDetail['executionPolicy'] };
    if (!body.executionPolicy) throw new ApiError(400, 'validation_failed', 'executionPolicy is required.');
    reply.send(successEnvelope(await sessionManager.updatePolicy(params.id, body.executionPolicy)));
  });

  app.post('/api/sessions/:id/pending/:pendingId/resolve', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const params = request.params as { id: string; pendingId: string };
    const body = resolvePendingSchema.parse(request.body ?? {});
    const resolution = body.resolution.text === undefined
      ? { optionId: body.resolution.optionId }
      : { optionId: body.resolution.optionId, text: body.resolution.text };
    await sessionManager.resolvePending(params.id, params.pendingId, resolution);
    reply.send(successEnvelope({ accepted: true }));
  });

  app.post('/api/sessions/:id/terminate', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as { force?: boolean };
    await sessionManager.terminate(params.id, Boolean(body.force));
    reply.send(successEnvelope({ accepted: true }));
  });

  app.get('/api/settings', async (request, reply) => {
    auth.requireAuth(request, reply);
    reply.send(successEnvelope(redactValue(config)));
  });

  app.put('/api/settings', async (request, reply) => {
    auth.requireAuth(request, reply, { stateChanging: true });
    const merged = mergeSettings(config, (request.body ?? {}) as Record<string, unknown>);
    config = await saveConfig(merged.config, paths);
    auth.updateConfig(config);
    readinessCache = null;
    reply.send(successEnvelope({ settings: redactValue(config), restartRequired: merged.restartRequired, reasons: merged.reasons }));
  });

  app.get('/api/doctor', async (request, reply) => {
    auth.requireAuth(request, reply);
    reply.send(successEnvelope((await loadReadiness()).doctor));
  });

  app.get('/api/events', { websocket: true }, (socket, request) => {
    if (!auth.isAuthenticated(request)) {
      socket.send(JSON.stringify({ type: 'error', code: 'unauthorized', message: 'Authenticate before opening the event stream.' }));
      socket.close();
      return;
    }

    let sessionIds: Set<string> | null = null;
    const sendSnapshotBundle = async (after: Record<string, number> = {}) => {
      const summaries = await sessionManager.listSessions();
      for (const summary of summaries) {
        if (sessionIds && !sessionIds.has(summary.id)) continue;
        const detail = sessionManager.getSession(summary.id);
        socket.send(JSON.stringify({ type: 'session.snapshot', session: detail }));
        const events = await sessionManager.getEvents(summary.id, after[summary.id] ?? 0, config.ui.eventPageSize);
        for (const event of events) {
          socket.send(JSON.stringify({ type: 'event', event }));
        }
      }
    };

    const unsubscribe = sessionManager.subscribe((event) => {
      if (sessionIds && !sessionIds.has(event.sessionId)) return;
      socket.send(JSON.stringify({ type: 'event', event }));
    });

    void sendSnapshotBundle();
    const heartbeat = setInterval(() => {
      socket.send(JSON.stringify({ type: 'heartbeat', serverTime: new Date().toISOString() }));
    }, 15_000);

    socket.on('message', (raw: Buffer | string) => {
      try {
        const message = JSON.parse(String(raw)) as { type?: string; sessionIds?: string[]; after?: Record<string, number> };
        if (message.type === 'subscribe') {
          sessionIds = message.sessionIds?.length ? new Set(message.sessionIds) : null;
          void sendSnapshotBundle(message.after ?? {});
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', code: 'invalid_subscription', message: 'Requested session is not available.' }));
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return { app, auth, config, paths, sessionManager, uptimeStartedAt };
}
