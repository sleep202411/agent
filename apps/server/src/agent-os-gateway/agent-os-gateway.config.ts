import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const configSchema = z.object({
  workerBaseUrl: z.string().url(),
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
    this.value = configSchema.parse({
      workerBaseUrl: raw.replace(/\/$/, ''),
      billing: 'free',
      rateLimit: 'disabled',
    });
  }
}
