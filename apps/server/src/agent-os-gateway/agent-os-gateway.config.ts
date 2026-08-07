import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const configSchema = z.object({
  workerBaseUrl: z.string().url(),
  /**
   * Shared secret for worker → Nest domain tool execution.
   * Required when Agent OS gateway module loads.
   */
  internalToken: z.string().min(16).max(256),
  /** Phase 1 free: no budget. Reserved for later. */
  billing: z.literal('free'),
  rateLimit: z.literal('disabled'),
});

export type AgentOsGatewayConfig = z.infer<typeof configSchema>;

@Injectable()
export class AgentOsGatewayConfigService {
  readonly value: AgentOsGatewayConfig;

  constructor() {
    const raw =
      process.env.AGENT_OS_WORKER_URL?.trim() || 'http://127.0.0.1:4301';
    const internalToken = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
    if (!internalToken || internalToken.length < 16) {
      throw new Error(
        'AGENT_OS_INTERNAL_TOKEN is required (min 16 chars) when Agent OS gateway loads.',
      );
    }
    this.value = configSchema.parse({
      workerBaseUrl: raw.replace(/\/$/, ''),
      internalToken,
      billing: 'free',
      rateLimit: 'disabled',
    });
  }
}
