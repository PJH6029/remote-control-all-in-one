import type { AdapterCapability, AdapterProbeResult, CreateSessionInput, ExecutionPolicy, PendingAction, SessionDetail, SessionEvent } from '../shared/contracts';

export interface AdapterCreateContext {
  session: SessionDetail;
  emit: (event: Omit<SessionEvent, 'id' | 'sessionId' | 'sequence' | 'createdAt'>) => Promise<void>;
}

export interface AdapterResumeInput {
  session: SessionDetail;
}

export interface PendingResolution {
  optionId: string;
  text?: string;
}

export interface AdapterSessionHandle {
  sendMessage(input: { text: string; clientMessageId: string }): Promise<void>;
  setMode(mode: 'build' | 'plan'): Promise<{ restartRequired: boolean }>;
  updateExecutionPolicy(executionPolicy: ExecutionPolicy): Promise<{ restartRequired: boolean }>;
  resolvePending(pending: PendingAction, resolution: PendingResolution): Promise<void>;
  terminate(force?: boolean): Promise<void>;
  reconcile?(): Promise<void>;
}

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  capability(): AdapterCapability;
  probe(): Promise<AdapterProbeResult>;
  optionSchema(): Promise<Record<string, unknown>>;
  createSession(input: CreateSessionInput, context: AdapterCreateContext): Promise<AdapterSessionHandle>;
  resumeSession(input: AdapterResumeInput, context: AdapterCreateContext): Promise<AdapterSessionHandle>;
}
