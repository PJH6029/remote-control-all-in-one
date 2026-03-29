import { z } from 'zod';

export const API_VERSION = '1';
export const DEFAULT_STORAGE_ROOT = '.codex-everywhere';
export const DEFAULT_BIND = '127.0.0.1';
export const DEFAULT_PORT = 4319;

export const executionPolicySchema = z.object({
  filesystem: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('workspace-write'),
  network: z.enum(['off', 'on']).default('on'),
  approvals: z.enum(['never', 'on-request']).default('on-request'),
  writableRoots: z.array(z.string()).default([]),
});

export const pendingOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['allow', 'deny', 'submit', 'cancel']).optional(),
});

export const pendingActionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: z.enum(['approval', 'question', 'plan']),
  status: z.enum(['open', 'resolved', 'expired', 'invalidated']),
  prompt: z.string(),
  options: z.array(pendingOptionSchema),
  defaultOptionId: z.string().optional(),
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  vendorPayload: z.record(z.string(), z.unknown()).optional(),
});

export const adapterCapabilitySchema = z.object({
  agentId: z.string(),
  displayName: z.string(),
  transport: z.enum(['pty', 'http', 'hybrid', 'internal']),
  supportsPlanMode: z.boolean(),
  supportsModeSwitch: z.boolean(),
  supportsExecutionPolicySwitch: z.boolean(),
  supportsPendingApprovals: z.boolean(),
  supportsQuestions: z.boolean(),
  supportsPlanRequests: z.boolean(),
  supportsTmuxAttach: z.boolean(),
  supportsStructuredEvents: z.boolean(),
  supportsResume: z.boolean(),
  supportsForceTerminate: z.boolean(),
  supportsLocalBrowserOpen: z.boolean(),
  planModeImplementation: z.enum(['native', 'emulated']).optional(),
  executionPolicyImplementation: z.enum(['native', 'adapter_enforced', 'limited']).optional(),
  notes: z.array(z.string()).default([]),
});

export const adapterProbeSchema = z.object({
  agentId: z.string(),
  installed: z.boolean(),
  binaryPath: z.string().nullable(),
  version: z.string().nullable(),
  authenticated: z.boolean().nullable(),
  tmuxAvailable: z.boolean(),
  status: z.enum(['healthy', 'warning', 'blocked']),
  summary: z.string(),
  details: z.array(z.string()).default([]),
});

export const sessionStatusSchema = z.enum([
  'starting',
  'idle',
  'running',
  'waiting_approval',
  'waiting_question',
  'waiting_plan',
  'restarting',
  'terminating',
  'terminated',
  'error',
]);

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  agentId: z.string(),
  status: sessionStatusSchema,
  mode: z.enum(['build', 'plan']),
  cwd: z.string(),
  hasPendingActions: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSequence: z.number().int().nonnegative(),
});

export const sessionDetailSchema = sessionSummarySchema.extend({
  executionPolicy: executionPolicySchema,
  capabilities: adapterCapabilitySchema,
  pendingActions: z.array(pendingActionSchema),
  adapterState: z.record(z.string(), z.unknown()).optional(),
});

export const sessionEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sequence: z.number().int().nonnegative(),
  type: z.string(),
  createdAt: z.string(),
  source: z.object({
    adapterId: z.string(),
    vendorEventType: z.string().optional(),
  }),
  data: z.record(z.string(), z.unknown()),
});

export const doctorCheckSchema = z.object({
  id: z.string(),
  status: z.enum(['healthy', 'warning', 'blocked']),
  summary: z.string(),
  details: z.array(z.string()).default([]),
});

export const doctorReportSchema = z.object({
  status: z.enum(['healthy', 'warning', 'blocked']),
  checks: z.array(doctorCheckSchema),
  agents: z.array(adapterProbeSchema),
  updatedAt: z.string(),
});

export const configSchema = z.object({
  server: z.object({
    host: z.string().default(DEFAULT_BIND),
    port: z.number().int().positive().default(DEFAULT_PORT),
    openBrowser: z.boolean().default(false),
    authMode: z.enum(['local-session', 'password']).default('local-session'),
    passwordHash: z.string().nullable().default(null),
  }),
  agents: z.object({
    defaultAgentId: z.string().default('fake'),
    codex: z.record(z.string(), z.unknown()).default({}),
    claude: z.record(z.string(), z.unknown()).default({}),
    opencode: z.record(z.string(), z.unknown()).default({}),
    fake: z.record(z.string(), z.unknown()).default({}),
  }),
  sessions: z.object({
    defaultMode: z.enum(['build', 'plan']).default('build'),
    defaultExecutionPolicy: executionPolicySchema.default({
      filesystem: 'workspace-write',
      network: 'on',
      approvals: 'on-request',
      writableRoots: [],
    }),
    titleStrategy: z.enum(['from-initial-prompt', 'manual']).default('from-initial-prompt'),
    autoRecovery: z.boolean().default(true),
  }),
  ui: z.object({
    showTerminalMirrorByDefault: z.boolean().default(true),
    eventPageSize: z.number().int().positive().default(200),
  }),
  retention: z.object({
    maxRecentSessions: z.number().int().positive().default(200),
    pruneTerminalLogsAfterDays: z.number().int().positive().default(30),
    pruneEventsAfterDays: z.number().int().positive().default(90),
  }),
});

export const createSessionSchema = z.object({
  agentId: z.string(),
  cwd: z.string(),
  title: z.string().default(''),
  initialPrompt: z.string(),
  mode: z.enum(['build', 'plan']),
  executionPolicy: executionPolicySchema,
  extraDirectories: z.array(z.string()).default([]),
  adapterOptions: z.record(z.string(), z.unknown()).default({}),
});

export const sendMessageSchema = z.object({
  text: z.string().min(1),
  clientMessageId: z.string().min(1),
});

export const resolvePendingSchema = z.object({
  resolution: z.object({
    optionId: z.string(),
    text: z.string().optional(),
  }),
});

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  mode: z.enum(['local-session', 'password']),
  csrfToken: z.string().optional(),
});

export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;
export type PendingAction = z.infer<typeof pendingActionSchema>;
export type AdapterCapability = z.infer<typeof adapterCapabilitySchema>;
export type AdapterProbeResult = z.infer<typeof adapterProbeSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type DoctorReport = z.infer<typeof doctorReportSchema>;
export type AppConfig = z.infer<typeof configSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export function successEnvelope<T>(data: T) {
  return {
    ok: true as const,
    apiVersion: API_VERSION,
    serverTime: new Date().toISOString(),
    data,
  };
}

export function errorEnvelope(code: string, message: string, details: Record<string, unknown> = {}) {
  return {
    ok: false as const,
    apiVersion: API_VERSION,
    serverTime: new Date().toISOString(),
    error: { code, message, details },
  };
}
