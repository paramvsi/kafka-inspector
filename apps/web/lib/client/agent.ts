// AgentClient: KafkaClient over the self-hosted agent's REST + WebSocket API (docs/AGENT_API.md).
// ponytail: phase 1 stub — implemented in phase 4 (prompts/07).
import type { KafkaClient } from '@ki/core';

export function createAgentClient(): KafkaClient {
  const notYet = () => Promise.reject(new Error('Agent mode is not built yet.'));
  return new Proxy({} as KafkaClient, { get: (_t, p) => (p === 'then' ? undefined : notYet) });
}
