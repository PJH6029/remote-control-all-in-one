import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';

import { createApp } from '../../src/server/app';
import { getStoragePaths } from '../../src/core/storage';

export interface RunningTestServer {
  app: FastifyInstance;
  root: string;
  url: string;
  stop: () => Promise<void>;
}

export async function startTestServer(): Promise<RunningTestServer> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rcaio-e2e-'));
  const services = await createApp(getStoragePaths(root));
  const url = await services.app.listen({ host: '127.0.0.1', port: 0 });
  return {
    app: services.app,
    root,
    url,
    stop: async () => {
      await services.app.close();
    },
  };
}
