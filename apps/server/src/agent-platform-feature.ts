import { z } from 'zod';

const featureEnvironmentSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    AGENT_PLATFORM_ENABLED: z.enum(['true', 'false']).optional(),
  })
  .passthrough();

export function loadAgentPlatformFeatureEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const parsed = featureEnvironmentSchema.parse(environment);
  if (parsed.AGENT_PLATFORM_ENABLED === undefined) {
    if (parsed.NODE_ENV === 'production') {
      throw new Error('AGENT_PLATFORM_ENABLED is required in production');
    }
    return false;
  }
  return parsed.AGENT_PLATFORM_ENABLED === 'true';
}
