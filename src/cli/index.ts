import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';

import { createApp } from '../server/app';
import { buildDoctorReport } from '../core/doctor';
import { loadConfig } from '../core/config';
import { ensureStoragePaths, getStoragePaths, readTextIfExists, removeIfExists } from '../core/storage';
import { writeDaemonRuntime } from '../core/event-store';
import { buildSpawnEnv } from '../adapters/command-path';

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie ? headers.getSetCookie() : [];
}

async function createDaemonClient(baseUrl: string) {
  let cookieHeader = '';
  let csrfToken = '';

  const sessionResponse = await fetch(`${baseUrl}/api/auth/session`);
  const setCookies = getSetCookies(sessionResponse);
  if (setCookies.length) {
    cookieHeader = setCookies.map((entry) => entry.split(';', 1)[0]).join('; ');
  }
  const sessionJson = await sessionResponse.json() as { data?: { authenticated?: boolean; mode?: 'local-session' | 'password'; csrfToken?: string } };
  csrfToken = sessionJson.data?.csrfToken ?? '';

  if (sessionJson.data?.mode === 'password' && !sessionJson.data.authenticated) {
    const password = process.env.RCAIO_PASSWORD;
    if (!password) throw new Error('RCAIO_PASSWORD is required for password-protected daemons.');
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const loginCookies = getSetCookies(loginResponse);
    if (loginCookies.length) cookieHeader = loginCookies.map((entry) => entry.split(';', 1)[0]).join('; ');
    const loginJson = await loginResponse.json() as { data?: { csrfToken?: string } };
    csrfToken = loginJson.data?.csrfToken ?? csrfToken;
  }

  return {
    async request(pathname: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers ?? {});
      if (cookieHeader) headers.set('cookie', cookieHeader);
      if (init.method && init.method !== 'GET' && init.method !== 'HEAD' && csrfToken) headers.set('x-csrf-token', csrfToken);
      if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
      const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || `Request failed: ${response.status}`);
      return json;
    },
  };
}

async function daemonStatus(paths = getStoragePaths()) {
  const pidText = await readTextIfExists(paths.daemonPidFile);
  const urlText = await readTextIfExists(paths.daemonUrlFile);
  const pid = pidText ? Number(pidText.trim()) : null;
  let running = false;
  if (pid) {
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }
  }
  return { pid, url: urlText?.trim() ?? null, running };
}

async function startDaemon() {
  const paths = getStoragePaths();
  const status = await daemonStatus(paths);
  if (status.running) {
    console.log(`Daemon already running at ${status.url}`);
    return;
  }

  const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const env = await buildSpawnEnv();
  const child = spawn(process.execPath, [tsxPath, 'src/cli/index.ts', 'internal-daemon'], {
    cwd: process.cwd(),
    detached: true,
    env,
    stdio: 'ignore',
  });
  child.unref();
  console.log('Daemon start requested.');
}

async function stopDaemon() {
  const paths = getStoragePaths();
  const status = await daemonStatus(paths);
  if (!status.pid || !status.running) {
    console.log('Daemon is not running.');
    await removeIfExists(paths.daemonPidFile);
    await removeIfExists(paths.daemonUrlFile);
    return;
  }
  process.kill(status.pid, 'SIGTERM');
  console.log('Daemon stop requested.');
}

async function runInternalDaemon() {
  const services = await createApp();
  const { app, config, paths } = services;
  const address = await app.listen({ host: config.server.host, port: config.server.port });
  await writeDaemonRuntime(paths, process.pid, address);
  console.log(`Daemon listening on ${address}`);
  const cleanup = async () => {
    await removeIfExists(paths.daemonPidFile);
    await removeIfExists(paths.daemonUrlFile);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void cleanup());
  process.on('SIGINT', () => void cleanup());
}

async function bootstrap(noLaunch: boolean) {
  const paths = getStoragePaths();
  await ensureStoragePaths(paths);
  const config = await loadConfig(paths);
  const appServices = await createApp(paths);
  const doctor = await buildDoctorReport(config, appServices.sessionManager.listAdapters(), paths);
  console.log(JSON.stringify({ config, doctor }, null, 2));
  if (!noLaunch) await startDaemon();
}

async function listAgents() {
  const services = await createApp();
  const doctor = await buildDoctorReport(services.config, services.sessionManager.listAdapters(), services.paths);
  const agents = await Promise.all(services.sessionManager.listAdapters().map(async (adapter) => ({
    id: adapter.id,
    displayName: adapter.displayName,
    capabilities: adapter.capability(),
    probe: await adapter.probe(),
  })));
  console.log(JSON.stringify({ doctor, agents }, null, 2));
  await services.app.close();
}

async function listSessionsCommand() {
  const status = await daemonStatus();
  if (!status.url) throw new Error('Daemon URL is unavailable. Start the daemon first.');
  const client = await createDaemonClient(status.url);
  const response = await client.request('/api/sessions');
  console.log(JSON.stringify(response.data, null, 2));
}

async function terminateSessionCommand(id: string) {
  const status = await daemonStatus();
  if (!status.url) throw new Error('Daemon URL is unavailable. Start the daemon first.');
  const client = await createDaemonClient(status.url);
  const response = await client.request(`/api/sessions/${id}/terminate`, { method: 'POST', body: JSON.stringify({ force: false }) });
  console.log(JSON.stringify(response.data, null, 2));
}

async function attachSessionCommand(id: string) {
  const status = await daemonStatus();
  if (!status.url) throw new Error('Daemon URL is unavailable. Start the daemon first.');
  const client = await createDaemonClient(status.url);
  const response = await client.request(`/api/sessions/${id}`);
  const session = response.data as { capabilities: { supportsTmuxAttach: boolean }; agentId: string };
  if (!session.capabilities.supportsTmuxAttach) {
    console.log(`Attach is not supported for session ${id} (${session.agentId}).`);
    return;
  }
  console.log(`Attach is declared for session ${id}, but tmux attach orchestration is not implemented in this initial slice.`);
}

async function main() {
  const [command, subcommand, ...rest] = process.argv.slice(2);

  if (command === 'internal-daemon') {
    await runInternalDaemon();
    return;
  }

  if (command === 'setup' && subcommand === 'bootstrap') {
    await bootstrap(rest.includes('--no-launch'));
    return;
  }

  if (command === 'daemon' && subcommand === 'start') return startDaemon();
  if (command === 'daemon' && subcommand === 'stop') return stopDaemon();
  if (command === 'daemon' && subcommand === 'restart') {
    await stopDaemon();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await startDaemon();
    return;
  }
  if (command === 'daemon' && subcommand === 'status') {
    console.log(JSON.stringify(await daemonStatus(), null, 2));
    return;
  }

  if (command === 'agents' && subcommand === 'list') return listAgents();
  if (command === 'agents' && subcommand === 'doctor') return listAgents();
  if (command === 'sessions' && subcommand === 'list') return listSessionsCommand();
  if (command === 'sessions' && subcommand === 'terminate' && rest[0]) return terminateSessionCommand(rest[0]);
  if (command === 'sessions' && subcommand === 'attach' && rest[0]) return attachSessionCommand(rest[0]);

  console.log(`Usage:
  tsx src/cli/index.ts setup bootstrap [--no-launch]
  tsx src/cli/index.ts daemon <start|stop|restart|status>
  tsx src/cli/index.ts agents <list|doctor>
  tsx src/cli/index.ts sessions <list|attach|terminate> [id]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
