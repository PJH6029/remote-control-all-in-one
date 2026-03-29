import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createApp } from '../../src/server/app';
import { saveConfig } from '../../src/core/config';
import { ensureStoragePaths, getStoragePaths, sessionEventFile } from '../../src/core/storage';

const execFileAsync = promisify(execFile);

function blocked(message: string): never {
  console.error(message);
  process.exit(2);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function hasBinary(command: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('which', [command]);
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}

async function findFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate port.'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.on('error', reject);
  });
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers;
  return typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
}

async function createClient(baseUrl: string) {
  let cookieHeader = '';
  let csrfToken = '';

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`);
  const setCookies = getSetCookies(sessionResponse);
  if (setCookies.length) cookieHeader = setCookies.map((entry: string) => entry.split(';', 1)[0]).join('; ');
  const sessionJson = await sessionResponse.json();
  csrfToken = sessionJson.data?.csrfToken ?? '';

  return {
    async request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers || {});
      if (cookieHeader) headers.set('cookie', cookieHeader);
      if (init.method && init.method !== 'GET' && init.method !== 'HEAD' && csrfToken) headers.set('x-csrf-token', csrfToken);
      if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
      const json = await response.json();
      if (!response.ok) {
        const error = new Error(json.error?.message || `Request failed: ${response.status}`) as Error & { code?: string };
        error.code = json.error?.code;
        throw error;
      }
      return json.data;
    },
  };
}

async function waitFor<T>(predicate: () => Promise<T | null>, timeoutMs = 60_000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out while waiting for expected state.');
}

async function pollSession(client: Awaited<ReturnType<typeof createClient>>, sessionId: string) {
  const [detail, history] = await Promise.all([
    client.request(`/api/sessions/${sessionId}`),
    client.request(`/api/sessions/${sessionId}/events`),
  ]);
  return { detail, history };
}

function isBlockedError(error: unknown): boolean {
  const text = String((error as { message?: string } | undefined)?.message || '').toLowerCase();
  return text.includes('not installed')
    || text.includes('not implemented')
    || text.includes('login')
    || text.includes('auth')
    || text.includes('credential')
    || text.includes('credit balance')
    || text.includes('quota')
    || text.includes('billing');
}

function blockedMessageFromHistory(items: Array<{ type: string; data: Record<string, unknown> }>): string | null {
  for (const event of items) {
    if (event.type === 'session.error' && isBlockedError({ message: event.data.message })) {
      return String(event.data.message);
    }
    if ((event.type === 'assistant.final' || event.type === 'assistant.delta') && isBlockedError({ message: event.data.text ?? event.data.textDelta })) {
      return String(event.data.text ?? event.data.textDelta);
    }
  }
  return null;
}

async function createWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'rcaio-live-workspace-'));
  await writeFile(path.join(workspace, 'README.md'), '# Live test\n', 'utf8');
  await writeFile(path.join(workspace, 'sample.txt'), 'sample\n', 'utf8');
  return workspace;
}

async function main() {
  const agentIndex = process.argv.findIndex((value) => value === '--agent');
  const agent = agentIndex >= 0 ? process.argv[agentIndex + 1] : undefined;
  if (!agent || !['codex', 'claude', 'opencode'].includes(agent)) {
    fail('Usage: npm run test:live -- --agent <codex|claude|opencode>');
  }

  const binary = agent === 'codex' ? 'codex' : agent === 'claude' ? 'claude' : 'opencode';
  if (!(await hasBinary(binary))) blocked(`${agent} is not installed; live test is blocked.`);

  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'rcaio-live-storage-'));
  const workspace = await createWorkspace();
  const port: number = await findFreePort();
  const paths = getStoragePaths(storageRoot);
  await ensureStoragePaths(paths);
  await saveConfig({
    server: { host: '127.0.0.1', port, openBrowser: false, authMode: 'local-session', passwordHash: null },
    agents: { defaultAgentId: agent, codex: {}, claude: {}, opencode: {}, fake: {} },
    sessions: {
      defaultMode: 'build',
      defaultExecutionPolicy: { filesystem: 'workspace-write', network: 'on', approvals: 'on-request', writableRoots: [] },
      titleStrategy: 'from-initial-prompt',
      autoRecovery: true,
    },
    ui: { showTerminalMirrorByDefault: true, eventPageSize: 200 },
    retention: { maxRecentSessions: 200, pruneTerminalLogsAfterDays: 30, pruneEventsAfterDays: 90 },
  }, paths);

  const services = await createApp(paths);
  const address = await services.app.listen({ host: '127.0.0.1', port: Number(port) });
  const client = await createClient(address);

  try {
    const agents = await client.request('/api/agents');
    const target = agents.agents.find((entry: any) => entry.probe.agentId === agent);
    if (!target) blocked(`${agent} is not exposed by the API.`);
    if (target.probe.status === 'blocked') blocked(`${agent} is blocked: ${target.probe.summary}`);

    let created;
    try {
      created = await client.request('/api/sessions', {
        method: 'POST',
        headers: { 'x-idempotency-key': `live-${agent}-create` },
        body: JSON.stringify({
          agentId: agent,
          cwd: workspace,
          title: '',
          initialPrompt: 'Reply exactly PLAN_OK. Do not use tools or modify files.',
          mode: 'plan',
          executionPolicy: { filesystem: 'read-only', network: 'off', approvals: 'on-request', writableRoots: [] },
          extraDirectories: [],
          adapterOptions: {},
        }),
      });
    } catch (error) {
      if (isBlockedError(error)) blocked((error as Error).message);
      throw error;
    }

    const sessionId = created.id;
    await waitFor(async () => {
      const { detail, history } = await pollSession(client, sessionId);
      const blockedMessage = blockedMessageFromHistory(history.items);
      if (blockedMessage) blocked(blockedMessage);
      const errorEvent = history.items.find((event: any) => event.type === 'session.error');
      if (errorEvent) {
        if (isBlockedError({ message: errorEvent.data.message })) blocked(errorEvent.data.message);
        throw new Error(errorEvent.data.message || 'Session errored during plan validation.');
      }
      return history.items.find((event: any) => event.type === 'assistant.final') ? { detail, history } : null;
    }, 90_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const sampleAfterPlan = await readFile(path.join(workspace, 'sample.txt'), 'utf8');
    if (sampleAfterPlan !== 'sample\n') fail('Plan mode mutated sample.txt.');

    await client.request(`/api/sessions/${sessionId}/mode`, { method: 'POST', body: JSON.stringify({ mode: 'build' }) });
    await client.request(`/api/sessions/${sessionId}/policy`, {
      method: 'POST',
      body: JSON.stringify({ executionPolicy: { filesystem: 'workspace-write', network: 'on', approvals: 'on-request', writableRoots: [workspace] } }),
    });

    await client.request(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Create a file named LIVE_TEST_OUTPUT.txt with exact contents live test ok and no trailing newline. Use a method that preserves the exact bytes. Stop after the file is written.', clientMessageId: `live-build-${Date.now()}` }),
    });

    await waitFor(async () => {
      const { detail, history } = await pollSession(client, sessionId);
      const blockedMessage = blockedMessageFromHistory(history.items);
      if (blockedMessage) blocked(blockedMessage);
      const openApproval = detail.pendingActions.find((pending: any) => pending.status === 'open' && pending.type === 'approval');
      if (openApproval) {
        await client.request(`/api/sessions/${sessionId}/pending/${openApproval.id}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ resolution: { optionId: 'allow' } }),
        });
        return null;
      }
      const errorEvent = history.items.find((event: any) => event.type === 'session.error');
      if (errorEvent) {
        if (isBlockedError({ message: errorEvent.data.message })) blocked(errorEvent.data.message);
        throw new Error(errorEvent.data.message || 'Session errored during build validation.');
      }
      try {
        const output = await readFile(path.join(workspace, 'LIVE_TEST_OUTPUT.txt'), 'utf8');
        if (output.trim() === 'live test ok' && output !== 'live test ok') {
          throw new Error('LIVE_TEST_OUTPUT.txt contained unexpected trailing whitespace.');
        }
        return output === 'live test ok' ? true : null;
      } catch {
        return null;
      }
    }, 120_000);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const output = await readFile(path.join(workspace, 'LIVE_TEST_OUTPUT.txt'), 'utf8');
    if (output !== 'live test ok') fail('LIVE_TEST_OUTPUT.txt contents did not match expected value.');

    await client.request(`/api/sessions/${sessionId}/terminate`, { method: 'POST', body: JSON.stringify({ force: false }) });
    await waitFor(async () => {
      const { detail, history } = await pollSession(client, sessionId);
      return detail.status === 'terminated' && history.items.some((event: any) => event.type === 'session.terminated') ? true : null;
    }, 30_000);

    const persistedEvents = await client.request(`/api/sessions/${sessionId}/events`);
    if (!persistedEvents.items.some((event: any) => event.type === 'session.started')) fail('Missing session.started event.');
    if (!persistedEvents.items.some((event: any) => event.type === 'assistant.final')) fail('Missing assistant.final event.');
    if (!persistedEvents.items.some((event: any) => event.type === 'session.terminated')) fail('Missing session.terminated event.');

    const eventLog = await readFile(sessionEventFile(paths, sessionId), 'utf8');
    if (!eventLog.trim()) fail('Persisted event log was empty.');

    console.error(`${agent} live test passed.`);
    process.exit(0);
  } catch (error) {
    if (isBlockedError(error)) blocked((error as Error).message);
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await services.app.close();
  }
}

main().catch((error) => {
  if (isBlockedError(error)) blocked((error as Error).message);
  fail(error instanceof Error ? error.message : String(error));
});
