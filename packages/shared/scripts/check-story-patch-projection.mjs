/**
 * Build gate for the `story.canvas.apply_patch` JSON Schema projection.
 *
 * `storyPatchActionInputJsonSchema()` refuses to emit a document that has
 * quietly lost a zod check the executor still enforces. Nothing else in the
 * package build executes it, so a refinement added to the patch schema would
 * compile, publish, and only surface when the server booted — or, worse, when a
 * model was told a payload was acceptable and the executor refused it.
 *
 * Running the projection here makes that a failed `npm run build -w @repo/shared`,
 * which is upstream of every app that consumes the manifest.
 */
import { storyPatchActionInputJsonSchema } from "../dist/story-agent.js";

try {
  storyPatchActionInputJsonSchema();
} catch (error) {
  console.error("Story patch projection check failed.\n");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
