import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';
import { OpenCodeAdapter } from './opencode';
import type { AgentAdapter } from './base';

export function createBuiltInAdapters(): AgentAdapter[] {
  return [
    new CodexAdapter(),
    new ClaudeAdapter(),
    new OpenCodeAdapter(),
  ];
}
