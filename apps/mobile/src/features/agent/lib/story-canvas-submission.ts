import { uuid } from "expo-modules-core";
import {
  generationCommand,
  generationSession,
  generationRetryCommand,
  getGenerationJob,
  type GenerationRetry,
  type GenerationCommand,
} from "@/features/ai-lab/jobs-api";
import {
  canvasSubmissionSchema,
  type CanvasSubmission,
  type CanvasSubmissionRecord,
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

type SaveDependencies = {
  queue: ReturnType<typeof canvasReconciliation>;
  encode(command: CanvasSubmissionRecord, signal: AbortSignal): Promise<string | null>;
};
/** Resolve older exact bytes before encoding against a fresh document. */
async function persistRecord(
  scope: CanvasWriteScope,
  command: CanvasSubmissionRecord,
  signal: AbortSignal,
  dependencies: SaveDependencies
) {
  generationSession(scope.generation, signal);
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
export async function persistCanvasSubmission(
  scope: CanvasWriteScope,
  userId: string,
  type: CanvasSubmission["type"],
  raw: GenerationCommand,
  signal: AbortSignal,
  dependencies: SaveDependencies
) {
  generationSession(scope.generation, signal);
  return persistRecord(
    scope,
    canvasSubmissionForCommand(scope, userId, type, raw),
    signal,
    dependencies
  );
}
export async function persistCanvasRetry(
  scope: CanvasWriteScope,
  userId: string,
  type: CanvasSubmission["type"],
  raw: GenerationRetry,
  signal: AbortSignal,
  dependencies: SaveDependencies,
  readJob = getGenerationJob
) {
  generationSession(scope.generation, signal);
  const command = generationRetryCommand.parse(raw);
  if (
    command.documentId !== scope.documentId ||
    command.storyProjectId !== scope.projectId ||
    command.projectId ||
    command.sourceSurface !== "fizzstudio-canvas"
  )
    throw Error("Retry does not belong to this Story canvas.");
  const job = await readJob(command.jobId, scope.generation, signal, {
    workspaceId: command.workspaceId!,
    storyProjectId: scope.projectId,
    documentId: scope.documentId,
    documentBlockId: command.documentBlockId!,
    sourceSurface: "fizzstudio-canvas",
  });
  generationSession(scope.generation, signal);
  if (job.type !== type || !["failed", "cancelled", "expired"].includes(job.status))
    throw Error("Only a failed generation of this card's media type can be retried.");
  return persistRecord(
    scope,
    {
      ownerId: userId,
      type,
      retry: {
        documentId: scope.documentId,
        documentBlockId: command.documentBlockId!,
        jobId: command.jobId,
      },
    },
    signal,
    dependencies
  );
}
