const state = {
  auth: null,
  csrfToken: '',
  sessions: [],
  sessionDetails: new Map(),
  events: new Map(),
  doctor: null,
  settings: null,
  agents: [],
  health: null,
  socket: null,
  connection: 'connecting',
  reconnectTimer: null,
  readinessLoading: false,
  createSessionError: '',
  sessionLoading: new Set(),
  sessionErrors: new Map(),
  filters: {
    search: '',
    status: 'all',
  },
};

const views = {
  login: document.querySelector('#login-view'),
  dashboard: document.querySelector('#dashboard-view'),
  workspace: document.querySelector('#workspace-view'),
  settings: document.querySelector('#settings-view'),
  doctor: document.querySelector('#doctor-view'),
};

const connectionPill = document.querySelector('#connection-pill');
const liveRegion = document.querySelector('#live-region');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function announce(message) {
  liveRegion.textContent = message;
}

function setConnectionState(next) {
  state.connection = next;
  const labels = {
    connecting: 'Connecting',
    open: 'Connected',
    closed: 'Reconnecting',
  };
  connectionPill.textContent = labels[next] || next;
  connectionPill.dataset.state = next;
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET' && init.method !== 'HEAD' && state.csrfToken) headers.set('x-csrf-token', state.csrfToken);
  const response = await fetch(path, { ...init, headers });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || `Request failed: ${response.status}`);
  return json.data;
}

function currentRoute() {
  const hash = location.hash || '#/dashboard';
  const [, route, maybeId] = hash.split('/');
  return { route: route || 'dashboard', id: maybeId };
}

function show(view) {
  Object.values(views).forEach((element) => element.classList.add('hidden'));
  views[view].classList.remove('hidden');
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function lastSequenceFor(sessionId) {
  const events = state.events.get(sessionId) || [];
  return events.at(-1)?.sequence ?? 0;
}

function upsertEvent(event) {
  const existing = state.events.get(event.sessionId) || [];
  if (!existing.some((entry) => entry.id === event.id)) {
    existing.push(event);
    existing.sort((a, b) => a.sequence - b.sequence);
  }
  state.events.set(event.sessionId, existing);
}

function adapterChoices() {
  if (!state.agents.length) {
    return '<option value="">Loading adapters…</option>';
  }
  return state.agents
    .map((agent) => `<option value="${escapeHtml(agent.probe.agentId)}">${escapeHtml(agent.capabilities.displayName)} — ${escapeHtml(agent.probe.status)}</option>`)
    .join('');
}

function defaultWorkingDirectory() {
  if (state.health?.daemon?.cwd) return state.health.daemon.cwd;
  if (state.sessions[0]?.cwd) return state.sessions[0].cwd;
  return '';
}

function queueSessionRefresh(sessionId) {
  if (!sessionId || state.sessionLoading.has(sessionId)) return;
  state.sessionLoading.add(sessionId);
  state.sessionErrors.delete(sessionId);
  void refreshSession(sessionId)
    .catch((error) => {
      state.sessionErrors.set(sessionId, error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      state.sessionLoading.delete(sessionId);
      rerender();
    });
}

function filteredSessions() {
  return state.sessions.filter((session) => {
    if (state.filters.status !== 'all' && session.status !== state.filters.status) return false;
    if (!state.filters.search) return true;
    const query = state.filters.search.toLowerCase();
    return session.title.toLowerCase().includes(query)
      || session.cwd.toLowerCase().includes(query)
      || session.agentId.toLowerCase().includes(query);
  });
}

function renderTranscript(events) {
  if (!events.length) return '<p class="muted">No transcript events yet.</p>';
  return events.map((event) => {
    const content = event.type === 'terminal.output'
      ? escapeHtml(event.data.chunk)
      : escapeHtml(event.data.text || event.data.textDelta || event.data.prompt || JSON.stringify(event.data));
    return `
      <article class="message ${escapeHtml(event.type.replace(/\./g, '-'))}">
        <div class="message-meta">
          <span class="channel">${escapeHtml(event.type)}</span>
          <span class="muted">#${event.sequence}</span>
        </div>
        <div class="message-body">${content.replace(/\n/g, '<br />')}</div>
      </article>
    `;
  }).join('');
}

function renderLogin() {
  show('login');
  views.login.innerHTML = `
    <section class="card narrow">
      <h2>Login required</h2>
      <p class="muted">This daemon is configured for password authentication.</p>
      <form id="login-form" class="stack-form">
        <label>Password <input type="password" name="password" required /></label>
        <button class="primary" type="submit">Login</button>
      </form>
    </section>
  `;
  views.login.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
    state.auth = data;
    state.csrfToken = data.csrfToken || '';
    await bootstrap();
  });
}

function renderDashboard() {
  show('dashboard');
  const sessions = filteredSessions();
  const readinessMessage = state.readinessLoading && !state.agents.length
    ? '<p class="muted">Loading adapter readiness…</p>'
    : '';
  const createDisabled = !state.agents.length;
  const createError = state.createSessionError
    ? `<p class="error-text" role="alert">${escapeHtml(state.createSessionError)}</p>`
    : '';
  views.dashboard.innerHTML = `
    <section class="card info-strip">
      <div>
        <h2>Daemon</h2>
        <p class="muted">${escapeHtml(state.health?.daemon?.bind || 'Unknown bind')} · uptime ${escapeHtml(state.health?.daemon?.uptimeSeconds ?? 0)}s</p>
      </div>
      <div>
        <h2>Doctor</h2>
        <p><span class="pill" data-state="${escapeHtml(state.doctor?.status || 'warning')}">${escapeHtml(state.doctor?.status || 'unknown')}</span></p>
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <h2>Create session</h2>
        <form id="new-session-form" class="stack-form">
          <label>Agent
            <select name="agentId">${adapterChoices()}</select>
          </label>
          <label>Working directory <input name="cwd" value="${escapeHtml(defaultWorkingDirectory())}" required /></label>
          <label>Optional title <input name="title" /></label>
          <label>Initial prompt <textarea name="initialPrompt" rows="4" required>Inspect the repository and summarize the next steps.</textarea></label>
          <div class="grid-3">
            <label>Mode
              <select name="mode"><option value="build">build</option><option value="plan">plan</option></select>
            </label>
            <label>Filesystem
              <select name="filesystem"><option value="workspace-write">workspace-write</option><option value="read-only">read-only</option><option value="danger-full-access">danger-full-access</option></select>
            </label>
            <label>Approvals
              <select name="approvals"><option value="on-request">on-request</option><option value="never">never</option></select>
            </label>
          </div>
          <div class="grid-2">
            <label>Network
              <select name="network"><option value="on">on</option><option value="off">off</option></select>
            </label>
            <label>Extra writable dirs (comma-separated)
              <input name="extraDirectories" placeholder="/path/one,/path/two" />
            </label>
          </div>
          ${createError}
          ${readinessMessage}
          <button class="primary" type="submit" ${createDisabled ? 'disabled' : ''}>${createDisabled ? 'Loading adapters…' : 'Create session'}</button>
        </form>
      </section>

      <section class="card">
        <h2>Adapter readiness</h2>
        <div class="list compact-list">${state.agents.map((agent) => `
          <article class="card">
            <div class="row-between">
              <h3>${escapeHtml(agent.capabilities.displayName)}</h3>
              <span class="pill" data-state="${escapeHtml(agent.probe.status)}">${escapeHtml(agent.probe.status)}</span>
            </div>
            <p>${escapeHtml(agent.probe.summary)}</p>
            <p class="muted">${escapeHtml((agent.probe.details || []).join(' • '))}</p>
          </article>
        `).join('')}</div>
      </section>
    </div>

    <section class="card">
      <div class="row-between wrap-gap">
        <div>
          <h2>Recent sessions</h2>
          <p class="muted">Search and filter the retained session list.</p>
        </div>
        <form id="session-filters" class="inline-form">
          <input type="search" name="search" placeholder="Search title, cwd, agent" value="${escapeHtml(state.filters.search)}" />
          <select name="status">
            ${['all', 'starting', 'idle', 'running', 'waiting_approval', 'waiting_question', 'waiting_plan', 'restarting', 'terminating', 'terminated', 'error'].map((status) => `<option value="${status}" ${state.filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </form>
      </div>
      <div class="list">${sessions.map((session) => `
        <button class="card secondary left-align" data-session-link="${escapeHtml(session.id)}">
          <div class="row-between">
            <h3>${escapeHtml(session.title)}</h3>
            <span class="pill" data-state="${escapeHtml(session.status)}">${escapeHtml(session.status)}</span>
          </div>
          <p>${escapeHtml(session.agentId)} · ${escapeHtml(session.mode)} · pending ${session.hasPendingActions ? 'yes' : 'no'}</p>
          <p class="muted">${escapeHtml(session.cwd)} · updated ${escapeHtml(formatTimestamp(session.updatedAt))}</p>
        </button>
      `).join('') || '<p class="muted">No matching sessions.</p>'}</div>
    </section>
  `;

  views.dashboard.querySelector('#session-filters').addEventListener('input', (event) => {
    const formData = new FormData(event.currentTarget);
    state.filters.search = String(formData.get('search') || '');
    state.filters.status = String(formData.get('status') || 'all');
    renderDashboard();
  });

  views.dashboard.querySelectorAll('[data-session-link]').forEach((button) => {
    button.addEventListener('click', () => {
      location.hash = `#/session/${button.dataset.sessionLink}`;
    });
  });

  views.dashboard.querySelector('#new-session-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const agentId = String(formData.get('agentId') || '');
    if (!agentId) {
      state.createSessionError = 'Wait for adapter readiness to load before creating a session.';
      announce(state.createSessionError);
      renderDashboard();
      return;
    }
    const extraDirectories = String(formData.get('extraDirectories') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    try {
      state.createSessionError = '';
      const detail = await api('/api/sessions', {
        method: 'POST',
        headers: { 'x-idempotency-key': `create-${Date.now()}` },
        body: JSON.stringify({
          agentId,
          cwd: formData.get('cwd'),
          title: formData.get('title') || '',
          initialPrompt: formData.get('initialPrompt'),
          mode: formData.get('mode'),
          executionPolicy: {
            filesystem: formData.get('filesystem'),
            network: formData.get('network'),
            approvals: formData.get('approvals'),
            writableRoots: extraDirectories,
          },
          extraDirectories,
          adapterOptions: {},
        }),
      });
      state.sessionDetails.set(detail.id, detail);
      await refreshSessions();
      location.hash = `#/session/${detail.id}`;
    } catch (error) {
      state.createSessionError = error instanceof Error ? error.message : String(error);
      announce(state.createSessionError);
      renderDashboard();
    }
  });
}

function renderWorkspace(sessionId) {
  const detail = state.sessionDetails.get(sessionId);
  if (!detail) {
    queueSessionRefresh(sessionId);
    show('workspace');
    const error = state.sessionErrors.get(sessionId);
    views.workspace.innerHTML = `
      <section class="card">
        <h2>${error ? 'Failed to load session' : 'Loading session…'}</h2>
        <p class="muted">${escapeHtml(error || 'Rehydrating transcript and session state.')}</p>
        <a class="link-button" href="#/dashboard">Back to dashboard</a>
      </section>
    `;
    return;
  }
  show('workspace');
  const events = state.events.get(sessionId) || [];
  const openPending = detail.pendingActions.filter((pending) => pending.status === 'open');
  views.workspace.innerHTML = `
    <div class="workspace-grid">
      <section class="card transcript-card">
        <div class="row-between wrap-gap">
          <div>
            <h2>${escapeHtml(detail.title)}</h2>
            <p class="muted">${escapeHtml(detail.agentId)} · ${escapeHtml(detail.status)} · ${escapeHtml(detail.mode)}</p>
          </div>
          <a class="link-button" href="#/dashboard">Back to dashboard</a>
        </div>
        <div class="transcript" aria-live="polite">${renderTranscript(events)}</div>
        <form id="composer-form" class="stack-form">
          <label>Message <textarea name="text" rows="3" required></textarea></label>
          <button class="primary" type="submit">Send</button>
        </form>
      </section>

      <aside class="workspace-sidebar">
        <section class="card">
          <h3>Pending actions</h3>
          <div class="pending-actions">${openPending.map((pending) => `
            <article class="card pending-card">
              <div class="row-between">
                <strong>${escapeHtml(pending.type)}</strong>
                <span class="pill" data-state="warning">open</span>
              </div>
              <p>${escapeHtml(pending.prompt)}</p>
              ${pending.type === 'question' ? `<input data-answer-input="${escapeHtml(pending.id)}" placeholder="Enter answer" />` : ''}
              <div class="inline-actions">${pending.options.map((option) => `<button type="button" data-resolve="${escapeHtml(pending.id)}" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`).join('')}</div>
            </article>
          `).join('') || '<p class="muted">No pending actions.</p>'}</div>
        </section>

        <section class="card">
          <h3>Session controls</h3>
          <div class="inline-actions wrap-gap">
            <button type="button" data-mode="build">Build mode</button>
            <button type="button" data-mode="plan">Plan mode</button>
            <button type="button" data-force="false" class="danger">Terminate</button>
            <button type="button" data-force="true" class="danger">Force terminate</button>
          </div>
          <form id="policy-form" class="stack-form compact-form">
            <div class="grid-3">
              <label>Filesystem
                <select name="filesystem">
                  ${['read-only', 'workspace-write', 'danger-full-access'].map((value) => `<option value="${value}" ${detail.executionPolicy.filesystem === value ? 'selected' : ''}>${value}</option>`).join('')}
                </select>
              </label>
              <label>Network
                <select name="network">
                  ${['on', 'off'].map((value) => `<option value="${value}" ${detail.executionPolicy.network === value ? 'selected' : ''}>${value}</option>`).join('')}
                </select>
              </label>
              <label>Approvals
                <select name="approvals">
                  ${['on-request', 'never'].map((value) => `<option value="${value}" ${detail.executionPolicy.approvals === value ? 'selected' : ''}>${value}</option>`).join('')}
                </select>
              </label>
            </div>
            <label>Writable roots (comma-separated)
              <input name="writableRoots" value="${escapeHtml(detail.executionPolicy.writableRoots.join(', '))}" />
            </label>
            <button type="submit">Update policy</button>
          </form>
          <div class="inline-actions wrap-gap">
            <button type="button" ${detail.capabilities.supportsTmuxAttach ? 'data-attach="true"' : 'disabled'}>${detail.capabilities.supportsTmuxAttach ? 'Attach' : 'Attach unavailable'}</button>
            <button type="button" disabled>Open directory</button>
          </div>
        </section>

        <section class="card metadata-card">
          <h3>Metadata</h3>
          <dl class="meta-list">
            <div><dt>Session</dt><dd>${escapeHtml(detail.id)}</dd></div>
            <div><dt>Adapter</dt><dd>${escapeHtml(detail.agentId)}</dd></div>
            <div><dt>CWD</dt><dd>${escapeHtml(detail.cwd)}</dd></div>
            <div><dt>Created</dt><dd>${escapeHtml(formatTimestamp(detail.createdAt))}</dd></div>
            <div><dt>Updated</dt><dd>${escapeHtml(formatTimestamp(detail.updatedAt))}</dd></div>
            <div><dt>Mode</dt><dd>${escapeHtml(detail.mode)}</dd></div>
            <div><dt>Approvals</dt><dd>${escapeHtml(detail.executionPolicy.approvals)}</dd></div>
            <div><dt>Filesystem</dt><dd>${escapeHtml(detail.executionPolicy.filesystem)}</dd></div>
            <div><dt>Network</dt><dd>${escapeHtml(detail.executionPolicy.network)}</dd></div>
            <div><dt>Capabilities</dt><dd>${escapeHtml(Object.entries(detail.capabilities).filter(([, value]) => value === true).map(([key]) => key).join(', ') || 'none')}</dd></div>
          </dl>
        </section>

        <section class="card">
          <h3>Terminal mirror</h3>
          <pre class="terminal">${escapeHtml(events.filter((event) => event.type === 'terminal.output').map((event) => event.data.chunk).join('') || 'No terminal output.')}</pre>
        </section>
      </aside>
    </div>
  `;

  views.workspace.querySelector('#composer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get('text');
    await api(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, clientMessageId: `msg_${Date.now()}` }),
    });
    event.currentTarget.reset();
  });

  views.workspace.querySelector('#policy-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const writableRoots = String(formData.get('writableRoots') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    await api(`/api/sessions/${sessionId}/policy`, {
      method: 'POST',
      body: JSON.stringify({ executionPolicy: {
        filesystem: formData.get('filesystem'),
        network: formData.get('network'),
        approvals: formData.get('approvals'),
        writableRoots,
      } }),
    });
  });

  views.workspace.querySelectorAll('[data-resolve]').forEach((button) => {
    button.addEventListener('click', async () => {
      const pendingId = button.dataset.resolve;
      const optionId = button.dataset.option;
      const textInput = views.workspace.querySelector(`[data-answer-input="${pendingId}"]`);
      await api(`/api/sessions/${sessionId}/pending/${pendingId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution: { optionId, text: textInput?.value || undefined } }),
      });
    });
  });

  views.workspace.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/sessions/${sessionId}/mode`, { method: 'POST', body: JSON.stringify({ mode: button.dataset.mode }) });
    });
  });

  views.workspace.querySelectorAll('[data-force]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/sessions/${sessionId}/terminate`, { method: 'POST', body: JSON.stringify({ force: button.dataset.force === 'true' }) });
      await refreshSessions();
    });
  });

  views.workspace.querySelector('[data-attach]')?.addEventListener('click', () => {
    alert('Attach is not available for the minimum releasable transport in this build.');
  });
}

function renderSettings() {
  show('settings');
  const settings = state.settings;
  if (!settings) {
    views.settings.innerHTML = `
      <section class="card">
        <h2>Settings</h2>
        <p class="muted">Loading settings…</p>
      </section>
    `;
    return;
  }
  views.settings.innerHTML = `
    <section class="card">
      <h2>Settings</h2>
      <form id="settings-form" class="stack-form">
        <div class="grid-3">
          <label>Host <input name="host" value="${escapeHtml(settings.server.host)}" /></label>
          <label>Port <input type="number" name="port" value="${escapeHtml(settings.server.port)}" /></label>
          <label>Auth mode
            <select name="authMode">
              <option value="local-session" ${settings.server.authMode === 'local-session' ? 'selected' : ''}>local-session</option>
              <option value="password" ${settings.server.authMode === 'password' ? 'selected' : ''}>password</option>
            </select>
          </label>
        </div>
        <div class="grid-3">
          <label>Show terminal by default
            <select name="showTerminalMirrorByDefault">
              <option value="true" ${settings.ui.showTerminalMirrorByDefault ? 'selected' : ''}>true</option>
              <option value="false" ${!settings.ui.showTerminalMirrorByDefault ? 'selected' : ''}>false</option>
            </select>
          </label>
          <label>Event page size <input type="number" name="eventPageSize" value="${escapeHtml(settings.ui.eventPageSize)}" /></label>
          <label>Max recent sessions <input type="number" name="maxRecentSessions" value="${escapeHtml(settings.retention.maxRecentSessions)}" /></label>
        </div>
        <div class="grid-2">
          <label>Prune terminal logs after days <input type="number" name="pruneTerminalLogsAfterDays" value="${escapeHtml(settings.retention.pruneTerminalLogsAfterDays)}" /></label>
          <label>Prune events after days <input type="number" name="pruneEventsAfterDays" value="${escapeHtml(settings.retention.pruneEventsAfterDays)}" /></label>
        </div>
        <button class="primary" type="submit">Save settings</button>
      </form>
    </section>
  `;

  views.settings.querySelector('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const result = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        server: {
          host: formData.get('host'),
          port: Number(formData.get('port')),
          authMode: formData.get('authMode'),
        },
        ui: {
          showTerminalMirrorByDefault: formData.get('showTerminalMirrorByDefault') === 'true',
          eventPageSize: Number(formData.get('eventPageSize')),
        },
        retention: {
          maxRecentSessions: Number(formData.get('maxRecentSessions')),
          pruneTerminalLogsAfterDays: Number(formData.get('pruneTerminalLogsAfterDays')),
          pruneEventsAfterDays: Number(formData.get('pruneEventsAfterDays')),
        },
      }),
    });
    state.settings = result.settings;
    announce(result.restartRequired ? `Settings saved. Restart required: ${result.reasons.join(', ')}` : 'Settings saved.');
    renderSettings();
  });
}

function renderDoctor() {
  show('doctor');
  const doctor = state.doctor;
  if (!doctor) {
    views.doctor.innerHTML = `
      <section class="card">
        <h2>Doctor</h2>
        <p class="muted">Loading operational readiness…</p>
      </section>
    `;
    return;
  }
  views.doctor.innerHTML = `
    <section class="card">
      <div class="row-between wrap-gap">
        <div>
          <h2>Doctor</h2>
          <p class="muted">Operational readiness and prerequisite visibility.</p>
        </div>
        <span class="pill" data-state="${escapeHtml(doctor.status)}">${escapeHtml(doctor.status)}</span>
      </div>
      <div class="grid-2">
        <div>
          <h3>Checks</h3>
          <div class="list compact-list">${doctor.checks.map((check) => `
            <article class="card">
              <div class="row-between">
                <strong>${escapeHtml(check.id)}</strong>
                <span class="pill" data-state="${escapeHtml(check.status)}">${escapeHtml(check.status)}</span>
              </div>
              <p>${escapeHtml(check.summary)}</p>
              <p class="muted">${escapeHtml((check.details || []).join(' • '))}</p>
            </article>
          `).join('')}</div>
        </div>
        <div>
          <h3>Adapters</h3>
          <div class="list compact-list">${doctor.agents.map((agent) => `
            <article class="card">
              <div class="row-between">
                <strong>${escapeHtml(agent.agentId)}</strong>
                <span class="pill" data-state="${escapeHtml(agent.status)}">${escapeHtml(agent.status)}</span>
              </div>
              <p>${escapeHtml(agent.summary)}</p>
              <p class="muted">${escapeHtml((agent.details || []).join(' • '))}</p>
            </article>
          `).join('')}</div>
        </div>
      </div>
    </section>
  `;
}

async function refreshSession(sessionId) {
  const [detail, history] = await Promise.all([
    api(`/api/sessions/${sessionId}`),
    api(`/api/sessions/${sessionId}/events?afterSequence=0&limit=${state.settings?.ui?.eventPageSize || 200}`),
  ]);
  state.sessionDetails.set(sessionId, detail);
  state.events.set(sessionId, history.items);
}

async function refreshSessions() {
  state.sessions = (await api('/api/sessions')).items;
  await Promise.all(state.sessions.map((session) => refreshSession(session.id)));
}

async function refreshGlobalData() {
  state.readinessLoading = true;
  const [agents, settings, health] = await Promise.all([
    api('/api/agents'),
    api('/api/settings'),
    api('/api/health'),
  ]);
  state.agents = agents.agents;
  state.doctor = agents.doctor;
  state.settings = settings;
  state.health = health;
  await refreshSessions();
  state.readinessLoading = false;
}

function connectSocket() {
  if (state.socket) state.socket.close();
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  setConnectionState('connecting');
  const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/api/events`);
  socket.addEventListener('open', () => {
    setConnectionState('open');
    const after = Object.fromEntries([...state.events.keys()].map((sessionId) => [sessionId, lastSequenceFor(sessionId)]));
    socket.send(JSON.stringify({ type: 'subscribe', after }));
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'session.snapshot') {
      state.sessionDetails.set(message.session.id, message.session);
      rerender();
      return;
    }
    if (message.type === 'event') {
      upsertEvent(message.event);
      api(`/api/sessions/${message.event.sessionId}`).then((detail) => {
        state.sessionDetails.set(detail.id, detail);
        state.sessions = state.sessions.map((session) => session.id === detail.id ? { ...session, ...detail } : session);
        if (!state.sessions.some((session) => session.id === detail.id)) state.sessions.unshift(detail);
        rerender();
      }).catch(console.error);
      rerender();
      return;
    }
  });
  socket.addEventListener('close', () => {
    setConnectionState('closed');
    state.reconnectTimer = setTimeout(() => connectSocket(), 1000);
  });
  socket.addEventListener('error', () => setConnectionState('closed'));
  state.socket = socket;
}

function rerender() {
  if (!state.auth?.authenticated && state.auth?.mode === 'password') {
    renderLogin();
    return;
  }
  const route = currentRoute();
  if (route.route === 'settings') return renderSettings();
  if (route.route === 'doctor') return renderDoctor();
  if (route.route === 'session' && route.id) return renderWorkspace(route.id);
  return renderDashboard();
}

async function bootstrap() {
  state.auth = await api('/api/auth/session').catch(async () => {
    const response = await fetch('/api/auth/session');
    const json = await response.json();
    return json.data;
  });
  state.csrfToken = state.auth?.csrfToken || '';
  if (!state.auth.authenticated && state.auth.mode === 'password') {
    renderLogin();
    return;
  }
  rerender();
  connectSocket();
  const route = currentRoute();
  if (route.route === 'session' && route.id) queueSessionRefresh(route.id);
  void refreshGlobalData()
    .catch((error) => {
      console.error(error);
      announce(`Failed to refresh application data: ${error.message}`);
    })
    .finally(() => {
      state.readinessLoading = false;
      rerender();
    });
}

window.addEventListener('hashchange', rerender);
bootstrap().catch((error) => {
  console.error(error);
  views.dashboard.classList.remove('hidden');
  views.dashboard.innerHTML = `<section class="card"><h2>Failed to load application</h2><p>${escapeHtml(error.message)}</p></section>`;
});
