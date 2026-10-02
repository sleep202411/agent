import { StoryBuildStatus } from '@prisma/client';
import {
  EXPERIENCE_RUNTIME_SCHEMA_VERSION,
  ExperienceRuntimeManifestSchema,
} from '@repo/shared/experience-runtime';

/**
 * What a frozen Build's runtime manifest asks of its audience. `invalid` is a
 * manifest that no longer parses: callers that hand out unsigned URLs must
 * treat it as not free (fail closed).
 */
export type StoryManifestAccess = 'free' | 'paid' | 'invalid';

/** Any node or route access rule makes the whole Build paid. */
export function storyManifestAccess(runtimeJson: unknown): StoryManifestAccess {
  const parsed = ExperienceRuntimeManifestSchema.safeParse(runtimeJson);
  if (!parsed.success) return 'invalid';
  return parsed.data.graph.nodes.some(
    (node) =>
      node.access ||
      node.eventBindings.some((binding) =>
        binding.routes.some((route) => route.access),
      ),
  )
    ? 'paid'
    : 'free';
}

/** The same gate `/content` applies before it serves any frozen media. */
export function isPlayableStoryBuild(build: {
  status: StoryBuildStatus;
  runtimeSchemaVersion: number;
}): boolean {
  return (
    build.status === StoryBuildStatus.ready &&
    build.runtimeSchemaVersion === EXPERIENCE_RUNTIME_SCHEMA_VERSION
  );
}
