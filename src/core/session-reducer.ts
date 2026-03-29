import { executionPolicySchema, pendingActionSchema, sessionSummarySchema, type PendingAction, type SessionDetail, type SessionEvent, type SessionSummary } from '../shared/contracts';

function upsertPending(items: PendingAction[], pending: PendingAction): PendingAction[] {
  const parsed = pendingActionSchema.parse(pending);
  const index = items.findIndex((item) => item.id === parsed.id);
  if (index === -1) return [...items, parsed];
  const next = [...items];
  next[index] = parsed;
  return next;
}

export function toSummary(detail: SessionDetail): SessionSummary {
  return sessionSummarySchema.parse({
    id: detail.id,
    title: detail.title,
    agentId: detail.agentId,
    status: detail.status,
    mode: detail.mode,
    cwd: detail.cwd,
    hasPendingActions: detail.pendingActions.some((pending) => pending.status === 'open'),
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    lastSequence: detail.lastSequence,
  });
}

export const toSessionSummary = toSummary;

export function applySessionEvent(detail: SessionDetail, event: SessionEvent): SessionDetail {
  const next: SessionDetail = {
    ...detail,
    pendingActions: [...detail.pendingActions],
    adapterState: detail.adapterState ? { ...detail.adapterState } : undefined,
    lastSequence: event.sequence,
    updatedAt: event.createdAt,
  };

  switch (event.type) {
    case 'session.started':
      next.status = 'idle';
      if (event.data.adapterState && typeof event.data.adapterState === 'object') next.adapterState = event.data.adapterState as Record<string, unknown>;
      break;
    case 'user.sent':
      next.status = 'running';
      break;
    case 'approval.requested':
    case 'question.requested':
    case 'plan.requested': {
      const pending = event.data.pendingAction as PendingAction | undefined;
      if (pending) next.pendingActions = upsertPending(next.pendingActions, pending);
      next.status = event.type === 'approval.requested'
        ? 'waiting_approval'
        : event.type === 'question.requested'
          ? 'waiting_question'
          : 'waiting_plan';
      break;
    }
    case 'approval.resolved':
    case 'question.resolved':
    case 'plan.resolved': {
      const pendingId = event.data.pendingId as string | undefined;
      if (pendingId) {
        next.pendingActions = next.pendingActions.map((pending) => pending.id === pendingId ? { ...pending, status: 'resolved' } : pending);
      }
      next.status = 'running';
      break;
    }
    case 'assistant.delta':
      next.status = 'running';
      break;
    case 'assistant.final':
      if (!next.pendingActions.some((pending) => pending.status === 'open')) next.status = 'idle';
      break;
    case 'session.updated':
      if (event.data.mode === 'build' || event.data.mode === 'plan') next.mode = event.data.mode;
      if (event.data.executionPolicy) next.executionPolicy = executionPolicySchema.parse(event.data.executionPolicy);
      if (typeof event.data.status === 'string') next.status = event.data.status as SessionDetail['status'];
      if (event.data.adapterState && typeof event.data.adapterState === 'object') next.adapterState = { ...(next.adapterState ?? {}), ...(event.data.adapterState as Record<string, unknown>) };
      if (event.data.capabilities && typeof event.data.capabilities === 'object') next.capabilities = event.data.capabilities as SessionDetail['capabilities'];
      break;
    case 'session.terminated':
      next.status = 'terminated';
      next.pendingActions = next.pendingActions.map((pending) => pending.status === 'open' ? { ...pending, status: 'invalidated' } : pending);
      break;
    case 'session.error':
      next.status = 'error';
      break;
    default:
      break;
  }

  next.hasPendingActions = next.pendingActions.some((pending) => pending.status === 'open');
  return next;
}

export function replaySession(detail: SessionDetail, events: SessionEvent[]): SessionDetail {
  return events.reduce((current, event) => applySessionEvent(current, event), detail);
}
