import { uuid } from "expo-modules-core";
import {
  generationCommand,
  generationSession,
  generationRetryCommand,
  getGenerationJob,
  type GenerationRetry,
  type GenerationReceipt,
  type GenerationCommand,
} from "@/features/ai-lab/jobs-api";
import {
  canvasSubmissionSchema,
  canvasAuthoringSchema,
  type CanvasAuthoring,
  type CanvasSubmission,
  type CanvasSubmissionRecord,
} from "../../../../canvas-editor/submission-schema";
import type { CanvasEditScope } from "./story-canvas-draft";
import { canvasGenerationOwner, matchesCanvasGenerationOwner } from "./canvas-generation-owner";
import type { canvasReconciliation } from "./story-canvas-reconciliation";

export function canvasSubmissionForCommand(
  scope: CanvasEditScope,
  userId: string,
  type: CanvasSubmission["type"],
  raw: GenerationCommand
): CanvasSubmission {
  const command = generationCommand.parse(raw);
  if (
    command.documentId !== scope.documentId ||
    !matchesCanvasGenerationOwner(scope, command) ||
    command.sourceSurface !== "fizzstudio-canvas"
  )
    throw Error("Submission does not belong to this canvas.");
  const {
    clientKey,
    canvasCardEdit,
    workspaceId,
    storyProjectId,
    projectId,
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
        cardEdit: canvasCardEdit,
        submission: {
          ...body,
          idempotencyKey: clientKey,
          context: {
            workspaceId,
            storyProjectId,
            projectId,
            documentId,
            documentBlockId,
            sourceSurface,
          },
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
  scope: CanvasEditScope,
  command: CanvasSubmissionRecord,
  signal: AbortSignal,
  dependencies: SaveDependencies
) {
  generationSession(scope.generation, signal);
  if (dependencies.queue.read()) await dependencies.queue.resume(signal);
  generationSession(scope.generation, signal);
  if (!dependencies.queue.canPrepare())
    throw Error("Finish the saved canvas action before saving further changes.");
  const update = await dependencies.encode(command, signal);
  generationSession(scope.generation, signal);
  if (!dependencies.queue.canPrepare())
    throw Error("Finish the saved canvas action before saving further changes.");
  if (update) {
    dependencies.queue.prepare({ clientKey: uuid.v4(), yjsUpdateBase64: update });
    await dependencies.queue.resume(signal);
    generationSession(scope.generation, signal);
  }
}
export async function persistCanvasSubmission(
  scope: CanvasEditScope,
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
  scope: CanvasEditScope,
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
    !matchesCanvasGenerationOwner(scope, command) ||
    command.sourceSurface !== "fizzstudio-canvas"
  )
    throw Error("Retry does not belong to this canvas.");
  const job = await readJob(command.jobId, scope.generation, signal, {
    workspaceId: command.workspaceId!,
    ...canvasGenerationOwner(scope),
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

/** Attach only a receipt returned by the original submission/retry endpoint. */
export async function persistCanvasReceipt(
  scope: CanvasEditScope,
  userId: string,
  type: CanvasSubmission["type"],
  raw: GenerationCommand | GenerationRetry,
  receipt: GenerationReceipt,
  signal: AbortSignal,
  dependencies: SaveDependencies,
  readJob = getGenerationJob
) {
  generationSession(scope.generation, signal);
  const command = "jobId" in raw ? generationRetryCommand.parse(raw) : generationCommand.parse(raw);
  if (
    command.documentId !== scope.documentId ||
    !matchesCanvasGenerationOwner(scope, command) ||
    command.sourceSurface !== "fizzstudio-canvas"
  )
    throw Error("Receipt does not belong to this canvas.");
  const job = await readJob(receipt.request_id, scope.generation, signal, {
    workspaceId: command.workspaceId!,
    ...canvasGenerationOwner(scope),
    documentId: scope.documentId,
    documentBlockId: command.documentBlockId!,
    sourceSurface: "fizzstudio-canvas",
  });
  generationSession(scope.generation, signal);
  const retry = "jobId" in command;
  if (
    job.type !== type ||
    (retry ? job.id === command.jobId : job.idempotencyKey !== command.clientKey)
  )
    throw Error("Generation receipt does not match the saved request.");
  return persistRecord(
    scope,
    {
      ownerId: userId,
      type,
      receipt: {
        documentId: scope.documentId,
        documentBlockId: command.documentBlockId!,
        submissionKey: retry ? `retry:${command.jobId}` : command.clientKey,
        jobId: job.id,
      },
    },
    signal,
    dependencies
  );
}

export async function persistCanvasAuthoring(
  scope: CanvasEditScope,
  command: CanvasAuthoring,
  signal: AbortSignal,
  dependencies: SaveDependencies
) {
  generationSession(scope.generation, signal);
  const parsed = canvasAuthoringSchema.parse(command);
  if (parsed.authoring.documentId !== scope.documentId)
    throw Error("Card belongs to another document.");
  return persistRecord(scope, parsed, signal, dependencies);
}
