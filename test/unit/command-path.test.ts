import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCommandBinary } from '../../src/adapters/command-path';

const createdPaths: string[] = [];

afterEach(async () => {
  for (const target of createdPaths.splice(0)) {
    await import('node:fs/promises').then(({ rm }) => rm(target, { recursive: true, force: true }));
  }
});

describe('resolveCommandBinary', () => {
  it('uses an explicit configured path even when PATH is empty', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rcaio-command-path-'));
    createdPaths.push(root);
    const fakeCodex = path.join(root, 'codex');
    await writeFile(fakeCodex, '#!/bin/sh\necho fake-codex\n', 'utf8');
    await chmod(fakeCodex, 0o755);

    const resolved = await resolveCommandBinary('codex', {
      configuredPath: fakeCodex,
      env: { PATH: '' },
    });

    expect(resolved).toBe(fakeCodex);
  });
});
