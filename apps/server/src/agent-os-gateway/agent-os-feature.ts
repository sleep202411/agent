import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.string().optional(),
    AGENT_OS_ENABLED: z.enum(['true', 'false']).optional(),
  })
  .passthrough();

/**
 * Agent OS is the new product path. Off by default until explicitly enabled.
 * Production must set AGENT_OS_ENABLED explicitly (no silent on).
 */
export function loadAgentOsFeatureEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const parsed = schema.parse(environment);
  if (parsed.AGENT_OS_ENABLED === undefined) {
    if (parsed.NODE_ENV === 'production') {
      return false;
    }
    return false;
  }
  return parsed.AGENT_OS_ENABLED === 'true';
}
