import { execFile } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function expandHome(value: string): string {
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function nvmBinDirs(homeDir: string): Promise<string[]> {
  const versionsRoot = path.join(homeDir, '.nvm', 'versions', 'node');
  try {
    const versionEntries = await readdir(versionsRoot, { withFileTypes: true });
    return versionEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsRoot, entry.name, 'bin'));
  } catch {
    return [];
  }
}

async function candidateDirectories(env: NodeJS.ProcessEnv): Promise<string[]> {
  const homeDir = env.HOME || os.homedir();
  const pathDirs = (env.PATH || '').split(path.delimiter);
  return unique([
    ...pathDirs,
    path.dirname(process.execPath),
    path.join(homeDir, '.local', 'bin'),
    path.join(homeDir, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    ...(await nvmBinDirs(homeDir)),
  ]);
}

export async function buildAugmentedPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return unique(await candidateDirectories(env)).join(path.delimiter);
}

export async function buildSpawnEnv(env: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  return {
    ...env,
    PATH: await buildAugmentedPath(env),
  };
}

export async function resolveCommandBinary(
  command: string,
  options: { configuredPath?: string | null; envVarNames?: string[]; env?: NodeJS.ProcessEnv } = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  const explicitCandidates = [
    options.configuredPath ?? undefined,
    ...(options.envVarNames ?? []).map((name) => env[name]),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(expandHome(value)));

  for (const candidate of explicitCandidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  const augmentedEnv = await buildSpawnEnv(env);
  try {
    const { stdout } = await execFileAsync('which', [command], { env: augmentedEnv });
    const located = stdout.trim();
    if (located && await isExecutable(located)) return located;
  } catch {
    // fall through to manual candidate search
  }

  for (const dir of await candidateDirectories(augmentedEnv)) {
    const candidate = path.join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }

  return null;
}
