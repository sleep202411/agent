import { z } from 'zod';
import Ajv from 'ajv';
import type { AiModelDefinition } from '../ai-generation/types';
import { nearestStoryDurationValue } from '../story-studio/story-production-generation.service';

export function appStoryAgentEnabled(env = process.env): boolean {
  if (!env.APP_STORY_AGENT_ENABLED || env.APP_STORY_AGENT_ENABLED === 'false')
    return false;
  if (env.APP_STORY_AGENT_ENABLED === 'true') return true;
  throw new Error('APP_STORY_AGENT_ENABLED must be true or false.');
}
export const PinnedModelsSchema = z
  .object({
    planner: z.string().min(1),
    author: z.string().min(1),
    image: z
      .object({ modelId: z.string(), schemaVersion: z.string() })
      .strict(),
    video: z
      .object({
        modelId: z.string(),
        schemaVersion: z.string(),
        clipDurationSeconds: z.array(z.number().int().min(1).max(15)).min(1),
      })
      .strict(),
  })
  .strict();

/** Pin the catalog's actual generation durations, with a 15-second App ceiling. */
export function appStoryVideoDurations(
  model: Pick<AiModelDefinition, 'input_schema'>,
): number[] {
  const properties = model.input_schema.properties ?? {};
  const property =
    properties.durationSeconds ??
    properties.duration_seconds ??
    properties.duration;
  if (!property)
    throw new Error('The configured video model has no duration contract.');
  const validate = new Ajv({ strict: false }).compile(property);
  const durations = Array.from({ length: 15 }, (_, index) => index + 1).filter(
    (seconds) => {
      const candidate = nearestStoryDurationValue(property, seconds);
      return candidate?.seconds === seconds && validate(candidate.value);
    },
  );
  if (durations.length === 0)
    throw new Error(
      'The configured video model supports no App clips of 15 seconds or less.',
    );
  return durations;
}
export function appStoryAgentConfig(env = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value)
      throw new Error(`${name} is required when App Story Agent is enabled.`);
    return value;
  };
  required('ALIBABA_API_KEY');
  const authorUrl = new URL(required('ALIBABA_BASE_URL'));
  if (
    authorUrl.protocol !== 'https:' ||
    authorUrl.username ||
    authorUrl.password ||
    authorUrl.search ||
    authorUrl.hash
  )
    throw new Error(
      'ALIBABA_BASE_URL must be a regional HTTPS compatibility URL.',
    );
  const workerUrl = required('APP_STORY_AGENT_WORKER_URL');
  const url = new URL(workerUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      'APP_STORY_AGENT_WORKER_URL must be an internal HTTP(S) origin.',
    );
  const token = required('APP_STORY_AGENT_INTERNAL_TOKEN');
  if (token.length < 32)
    throw new Error(
      'APP_STORY_AGENT_INTERNAL_TOKEN must have at least 32 characters.',
    );
  const authorizationLimit = Number(
    required('APP_STORY_AGENT_AUTHORIZATION_POINTS'),
  );
  if (
    !Number.isInteger(authorizationLimit) ||
    authorizationLimit < 1 ||
    authorizationLimit > 1_000_000
  )
    throw new Error(
      'APP_STORY_AGENT_AUTHORIZATION_POINTS must be an integer from 1 to 1000000.',
    );
  const video = required('APP_STORY_AGENT_VIDEO_MODEL');
  if (video === 'seedance-2-0')
    throw new Error(
      'Seedance 2.0 is no longer supported by App Story Agent. Configure an available video model.',
    );
  return {
    workerUrl,
    token,
    authorizationLimit,
    planner: required('APP_STORY_AGENT_MODEL'),
    author: required('APP_STORY_AGENT_AUTHOR_MODEL'),
    image: required('APP_STORY_AGENT_IMAGE_MODEL'),
    video,
  };
}
