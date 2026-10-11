import { requiredEnv } from '../common/required-env';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  MODEL_PROFILE_ID_MAX_LENGTH,
  MODEL_PROFILE_ID_PATTERN,
} from '@repo/shared';

const configSchema = z.object({
  workerBaseUrl: z.string().url(),
  mobileChatModelProfileId: z
    .string()
    .min(1)
    .max(MODEL_PROFILE_ID_MAX_LENGTH)
    .regex(MODEL_PROFILE_ID_PATTERN),
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

/** Values documented in .env.example — never real secrets. */
const PLACEHOLDER_TOKENS = new Set([
  'dev-only-change-me-16+',
  'change-me-to-a-real-secret',
]);

@Injectable()
export class AgentOsGatewayConfigService {
  readonly value: AgentOsGatewayConfig;

  constructor() {
    const raw = requiredEnv('AGENT_OS_WORKER_URL');
    const internalToken = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
    if (!internalToken || internalToken.length < 16) {
      throw new Error(
        'AGENT_OS_INTERNAL_TOKEN is required (min 16 chars) when Agent OS gateway loads.',
      );
    }
    // The value shipped in .env.example is long enough to pass the length check,
    // so a copied template would otherwise boot with a publicly known secret
    // that authorises acting as any user on any project.
    if (PLACEHOLDER_TOKENS.has(internalToken)) {
      throw new Error(
        'AGENT_OS_INTERNAL_TOKEN is still the example value from .env.example. ' +
          'Generate a real secret — this token authorises writes as any user.',
      );
    }
    this.value = configSchema.parse({
      workerBaseUrl: raw.replace(/\/$/, ''),
      mobileChatModelProfileId: requiredEnv('AGENT_OS_MOBILE_CHAT_MODEL'),
      internalToken,
      billing: 'free',
      rateLimit: 'disabled',
    });
  }
}
