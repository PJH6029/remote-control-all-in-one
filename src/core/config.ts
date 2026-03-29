import { createHash } from 'node:crypto';

import { configSchema, DEFAULT_BIND, DEFAULT_PORT, type AppConfig } from '../shared/contracts';
import { getStoragePaths, readJsonIfExists, writeJsonAtomic, type StoragePaths } from './storage';

function defaultConfig(): AppConfig {
  return configSchema.parse({
    server: {
      host: DEFAULT_BIND,
      port: DEFAULT_PORT,
      openBrowser: false,
      authMode: 'local-session',
      passwordHash: null,
    },
    agents: {
      defaultAgentId: 'fake',
      codex: {},
      claude: {},
      opencode: {},
      fake: {},
    },
    sessions: {
      defaultMode: 'build',
      defaultExecutionPolicy: {
        filesystem: 'workspace-write',
        network: 'on',
        approvals: 'on-request',
        writableRoots: [],
      },
      titleStrategy: 'from-initial-prompt',
      autoRecovery: true,
    },
    ui: {
      showTerminalMirrorByDefault: true,
      eventPageSize: 200,
    },
    retention: {
      maxRecentSessions: 200,
      pruneTerminalLogsAfterDays: 30,
      pruneEventsAfterDays: 90,
    },
  });
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const next = structuredClone(config);
  if (process.env.CODEX_EVERYWHERE_HOST) next.server.host = process.env.CODEX_EVERYWHERE_HOST;
  if (process.env.CODEX_EVERYWHERE_PORT) next.server.port = Number(process.env.CODEX_EVERYWHERE_PORT);
  if (process.env.CODEX_EVERYWHERE_OPEN_BROWSER) next.server.openBrowser = ['1', 'true', 'yes'].includes(process.env.CODEX_EVERYWHERE_OPEN_BROWSER.toLowerCase());
  if (process.env.CODEX_EVERYWHERE_AUTH_MODE === 'local-session' || process.env.CODEX_EVERYWHERE_AUTH_MODE === 'password') {
    next.server.authMode = process.env.CODEX_EVERYWHERE_AUTH_MODE;
  }
  if (process.env.CODEX_EVERYWHERE_CODEX_PATH) {
    next.agents.codex = { ...next.agents.codex, binaryPath: process.env.CODEX_EVERYWHERE_CODEX_PATH };
  }
  return configSchema.parse(next);
}

function mergeWithDefaults(existing: Partial<AppConfig>): AppConfig {
  const defaults = defaultConfig();
  return configSchema.parse({
    ...defaults,
    ...existing,
    server: { ...defaults.server, ...(existing.server ?? {}) },
    agents: { ...defaults.agents, ...(existing.agents ?? {}) },
    sessions: { ...defaults.sessions, ...(existing.sessions ?? {}) },
    ui: { ...defaults.ui, ...(existing.ui ?? {}) },
    retention: { ...defaults.retention, ...(existing.retention ?? {}) },
  });
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function loadConfig(paths: StoragePaths = getStoragePaths()): Promise<AppConfig> {
  const existing = await readJsonIfExists<AppConfig>(paths.configFile);
  if (!existing) {
    const config = defaultConfig();
    await saveConfig(config, paths);
    return config;
  }
  return applyEnvOverrides(mergeWithDefaults(existing));
}

export async function saveConfig(config: AppConfig, paths: StoragePaths = getStoragePaths()): Promise<AppConfig> {
  const parsed = configSchema.parse(config);
  await writeJsonAtomic(paths.configFile, parsed);
  return parsed;
}
