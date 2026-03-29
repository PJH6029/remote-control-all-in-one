import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { AgentAdapter } from '../adapters/base';
import { type AdapterProbeResult, type AppConfig, type DoctorReport } from '../shared/contracts';
import { persistDoctorReport, appendProbeLog } from './event-store';
import type { StoragePaths } from './storage';

const execFileAsync = promisify(execFile);

function combineStatus(values: Array<'healthy' | 'warning' | 'blocked'>): 'healthy' | 'warning' | 'blocked' {
  if (values.includes('blocked')) return 'blocked';
  if (values.includes('warning')) return 'warning';
  return 'healthy';
}

export async function buildDoctorReport(
  config: AppConfig,
  adapters: AgentAdapter[],
  paths: StoragePaths,
  precomputedAgentReports?: AdapterProbeResult[],
): Promise<DoctorReport> {
  const checks: DoctorReport['checks'] = [];

  const tmuxCheck = await execFileAsync('which', ['tmux']).then(
    ({ stdout }) => ({ id: 'tmux', status: 'healthy' as const, summary: `tmux available at ${stdout.trim()}.`, details: [] }),
    () => ({ id: 'tmux', status: 'warning' as const, summary: 'tmux is not installed.', details: ['Attach support will be unavailable for PTY-based adapters.'] }),
  );
  checks.push(tmuxCheck);

  const configCheck = await access(paths.configFile).then(
    () => ({ id: 'config', status: 'healthy' as const, summary: 'Config file is present.', details: [] }),
    () => ({ id: 'config', status: 'warning' as const, summary: 'Config file will be created on first bootstrap.', details: [] }),
  );
  checks.push(configCheck);

  checks.push({
    id: 'auth',
    status: config.server.authMode === 'password' && !config.server.passwordHash ? 'blocked' : 'healthy',
    summary: config.server.authMode === 'password' && !config.server.passwordHash
      ? 'Password mode is configured without a password hash.'
      : `Auth mode ${config.server.authMode} is ready.`,
    details: config.server.authMode === 'password' && !config.server.passwordHash ? ['Set server.passwordHash to enable password login.'] : [],
  });

  const agentReports = precomputedAgentReports ?? await Promise.all(adapters.map((adapter) => adapter.probe()));
  for (const report of agentReports) {
    await appendProbeLog(paths, report);
  }

  const status = combineStatus([...checks.map((check) => check.status), ...agentReports.map((agent) => agent.status)]);
  const report = {
    status,
    checks,
    agents: agentReports,
    updatedAt: new Date().toISOString(),
  } satisfies DoctorReport;
  await persistDoctorReport(paths, report);
  return report;
}
