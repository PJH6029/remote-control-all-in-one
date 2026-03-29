import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { createApp } from '../../src/server/app';
import { getStoragePaths } from '../../src/core/storage';

async function getAuthSession(app: FastifyInstance) {
  const response = await app.inject({ method: 'GET', url: '/api/auth/session' });
  const csrfToken = response.json().data.csrfToken;
  const cookie = response.cookies.find((entry: { name: string }) => entry.name === 'rcaio_session');
  const csrfCookie = response.cookies.find((entry: { name: string }) => entry.name === 'rcaio_csrf');
  if (!cookie || !csrfCookie) {
    throw new Error('Expected auth cookies to be set.');
  }
  return {
    cookieHeader: `${cookie.name}=${cookie.value}; ${csrfCookie.name}=${csrfCookie.value}`,
    csrfToken,
  };
}

describe('api', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'rcaio-api-'));
  });

  it('creates and drives a fake session', async () => {
    const services = await createApp(getStoragePaths(root));
    const { app } = services;
    const auth = await getAuthSession(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: {
        agentId: 'fake',
        cwd: root,
        title: '',
        initialPrompt: 'hello world',
        mode: 'build',
        executionPolicy: { filesystem: 'workspace-write', network: 'on', approvals: 'on-request', writableRoots: [] },
        extraDirectories: [],
        adapterOptions: {},
      },
    });
    expect(createResponse.statusCode).toBe(200);
    const detail = createResponse.json().data;

    const messageResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/messages`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { text: 'need approval', clientMessageId: 'msg_1' },
    });
    expect(messageResponse.statusCode).toBe(200);

    const detailResponse = await app.inject({ method: 'GET', url: `/api/sessions/${detail.id}`, headers: { cookie: auth.cookieHeader } });
    const updated = detailResponse.json().data;
    const pending = updated.pendingActions.find((entry: { status: string }) => entry.status === 'open');
    expect(pending).toBeTruthy();
    if (!pending) throw new Error('Expected a pending action.');
    expect(pending.type).toBe('approval');

    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/pending/${pending.id}/resolve`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { resolution: { optionId: 'allow' } },
    });
    expect(resolveResponse.statusCode).toBe(200);

    const terminateResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/terminate`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { force: false },
    });
    expect(terminateResponse.statusCode).toBe(200);

    await app.close();
  });

  it('exposes distinct fake plan-request options and resolves accept', async () => {
    const services = await createApp(getStoragePaths(root));
    const { app } = services;
    const auth = await getAuthSession(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: {
        agentId: 'fake',
        cwd: root,
        title: '',
        initialPrompt: 'hello world',
        mode: 'plan',
        executionPolicy: { filesystem: 'read-only', network: 'off', approvals: 'on-request', writableRoots: [] },
        extraDirectories: [],
        adapterOptions: {},
      },
    });
    const detail = createResponse.json().data;

    await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/messages`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { text: 'need plan', clientMessageId: 'msg_plan_accept' },
    });

    const detailResponse = await app.inject({ method: 'GET', url: `/api/sessions/${detail.id}`, headers: { cookie: auth.cookieHeader } });
    const updated = detailResponse.json().data;
    const pending = updated.pendingActions.find((entry: { status: string; type: string }) => entry.status === 'open' && entry.type === 'plan');
    expect(pending).toBeTruthy();
    if (!pending) throw new Error('Expected a plan pending action.');
    expect(pending.options.map((option: { id: string }) => option.id)).toEqual(['accept', 'stay_in_plan']);

    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/pending/${pending.id}/resolve`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { resolution: { optionId: 'accept' } },
    });
    expect(resolveResponse.statusCode).toBe(200);

    await app.close();
  });

  it('resolves a fake plan request with stay_in_plan', async () => {
    const services = await createApp(getStoragePaths(root));
    const { app } = services;
    const auth = await getAuthSession(app);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: {
        agentId: 'fake',
        cwd: root,
        title: '',
        initialPrompt: 'hello world',
        mode: 'plan',
        executionPolicy: { filesystem: 'read-only', network: 'off', approvals: 'on-request', writableRoots: [] },
        extraDirectories: [],
        adapterOptions: {},
      },
    });
    const detail = createResponse.json().data;

    await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/messages`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { text: 'need plan', clientMessageId: 'msg_plan_stay' },
    });

    const detailResponse = await app.inject({ method: 'GET', url: `/api/sessions/${detail.id}`, headers: { cookie: auth.cookieHeader } });
    const updated = detailResponse.json().data;
    const pending = updated.pendingActions.find((entry: { status: string; type: string }) => entry.status === 'open' && entry.type === 'plan');
    expect(pending).toBeTruthy();
    if (!pending) throw new Error('Expected a plan pending action.');

    const resolveResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${detail.id}/pending/${pending.id}/resolve`,
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: { resolution: { optionId: 'stay_in_plan' } },
    });
    expect(resolveResponse.statusCode).toBe(200);

    await app.close();
  });

  it('rejects session creation when the working directory does not exist', async () => {
    const services = await createApp(getStoragePaths(root));
    const { app } = services;
    const auth = await getAuthSession(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { cookie: auth.cookieHeader, 'x-csrf-token': auth.csrfToken },
      payload: {
        agentId: 'codex',
        cwd: path.join(root, 'missing-directory'),
        title: '',
        initialPrompt: 'print list of files',
        mode: 'build',
        executionPolicy: { filesystem: 'workspace-write', network: 'on', approvals: 'on-request', writableRoots: [] },
        extraDirectories: [],
        adapterOptions: {},
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error?.message).toContain('Working directory does not exist');

    await app.close();
  });
});
