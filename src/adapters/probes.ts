import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';
import { OpenCodeAdapter } from './opencode';
import type { AgentAdapter } from './base';

export function createBuiltInAdapters(agentSettings: Record<string, Record<string, unknown>> = {}): AgentAdapter[] {
  return [
    new CodexAdapter(agentSettings.codex),
    new ClaudeAdapter(),
    new OpenCodeAdapter(),
  ];
}
