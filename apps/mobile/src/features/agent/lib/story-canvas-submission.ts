import { uuid } from "expo-modules-core";
import {
  generationCommand,
  generationSession,
  type GenerationCommand,
} from "@/features/ai-lab/jobs-api";
import {
  canvasSubmissionSchema,
  type CanvasSubmission,
} from "../../../../canvas-editor/submission-schema";
import type { CanvasWriteScope } from "../api/story-canvas-update";
import type { canvasReconciliation } from "./story-canvas-reconciliation";

export function canvasSubmissionForCommand(
  scope: CanvasWriteScope,
  userId: string,
  type: CanvasSubmission["type"],
  raw: GenerationCommand
): CanvasSubmission {
  const command = generationCommand.parse(raw);
  if (
    command.documentId !== scope.documentId ||
    command.storyProjectId !== scope.projectId ||
    command.projectId ||
    command.sourceSurface !== "fizzstudio-canvas"
  )
    throw Error("Submission does not belong to this Story canvas.");
  const {
    clientKey,
    workspaceId,
    storyProjectId,
    projectId: _projectId,
    documentId,
    documentBlockId,
    sourceSurface,
    ...body
  } = command;
  return canvasSubmissionSchema.parse(
    JSON.parse(
      JSON.stringify({
        ownerId: userId,
        type,
        submission: {
          ...body,
          idempotencyKey: clientKey,
          context: { workspaceId, storyProjectId, documentId, documentBlockId, sourceSurface },
        },
      })
    )
  );
}
/** Resolve the exact older write first, then encode against a fresh document.
 * Returning is the precondition for the composer to submit the paid request. */
export async function persistCanvasSubmission(
  scope: CanvasWriteScope,
  userId: string,
  type: CanvasSubmission["type"],
  raw: GenerationCommand,
  signal: AbortSignal,
  dependencies: {
    queue: ReturnType<typeof canvasReconciliation>;
    encode(command: CanvasSubmission, signal: AbortSignal): Promise<string | null>;
  }
) {
  generationSession(scope.generation, signal);
  const command = canvasSubmissionForCommand(scope, userId, type, raw);
  if (dependencies.queue.read()) await dependencies.queue.resume(signal);
  generationSession(scope.generation, signal);
  if (!dependencies.queue.canPrepare())
    throw Error("Finish the saved canvas action before generating.");
  const update = await dependencies.encode(command, signal);
  generationSession(scope.generation, signal);
  if (!dependencies.queue.canPrepare())
    throw Error("Finish the saved canvas action before generating.");
  if (update) {
    dependencies.queue.prepare({ clientKey: uuid.v4(), yjsUpdateBase64: update });
    await dependencies.queue.resume(signal);
    generationSession(scope.generation, signal);
  }
}
