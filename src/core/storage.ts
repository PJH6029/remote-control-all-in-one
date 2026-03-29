import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface StoragePaths {
  root: string;
  configFile: string;
  doctorFile: string;
  stateDir: string;
  activeSessionsFile: string;
  sessionEventsDir: string;
  sessionSnapshotsDir: string;
  adapterStateDir: string;
  logsDir: string;
  sessionLogsDir: string;
  adapterProbeLogFile: string;
  daemonLogFile: string;
  runtimeDir: string;
  daemonPidFile: string;
  daemonUrlFile: string;
  tmpDir: string;
}

export function getStorageRoot(): string {
  return process.env.CODEX_EVERYWHERE_ROOT || path.join(os.homedir(), '.codex-everywhere');
}

export function getStoragePaths(root = getStorageRoot()): StoragePaths {
  return {
    root,
    configFile: path.join(root, 'config.json'),
    doctorFile: path.join(root, 'state', 'doctor.json'),
    stateDir: path.join(root, 'state'),
    activeSessionsFile: path.join(root, 'state', 'active-sessions.json'),
    sessionEventsDir: path.join(root, 'state', 'session-events'),
    sessionSnapshotsDir: path.join(root, 'state', 'session-snapshots'),
    adapterStateDir: path.join(root, 'state', 'adapter'),
    logsDir: path.join(root, 'logs'),
    sessionLogsDir: path.join(root, 'logs', 'sessions'),
    adapterProbeLogFile: path.join(root, 'logs', 'adapter-probe.log'),
    daemonLogFile: path.join(root, 'logs', 'daemon.log'),
    runtimeDir: path.join(root, 'runtime'),
    daemonPidFile: path.join(root, 'runtime', 'daemon.pid'),
    daemonUrlFile: path.join(root, 'runtime', 'daemon-url.txt'),
    tmpDir: path.join(root, 'tmp'),
  };
}

export async function ensureStoragePaths(paths: StoragePaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await Promise.all([
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.sessionEventsDir, { recursive: true }),
    mkdir(paths.sessionSnapshotsDir, { recursive: true }),
    mkdir(paths.adapterStateDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.sessionLogsDir, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true }),
    mkdir(paths.tmpDir, { recursive: true }),
  ]);
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  const text = await readTextIfExists(filePath);
  if (!text) {
    return undefined;
  }
  return JSON.parse(text) as T;
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempFile, filePath);
}

export async function removeIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export function sessionEventFile(paths: StoragePaths, sessionId: string): string {
  return path.join(paths.sessionEventsDir, `${sessionId}.jsonl`);
}

export function sessionSnapshotFile(paths: StoragePaths, sessionId: string): string {
  return path.join(paths.sessionSnapshotsDir, `${sessionId}.json`);
}

export function sessionLogFile(paths: StoragePaths, sessionId: string): string {
  return path.join(paths.sessionLogsDir, `${sessionId}.log`);
}

export function adapterStatePath(paths: StoragePaths, adapterId: string): string {
  return path.join(paths.adapterStateDir, adapterId);
}
