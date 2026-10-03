import type { FizzAiSubmitJobInput } from "./generation-api";

/** Browser-owned command receipt, not a second copy of server job state. */
export interface GenerationSubmissionReceipt {
  version: 1;
  request: FizzAiSubmitJobInput;
  prompt: string;
  createdAt: string;
}

export function generationReceiptKey(ownerId: string, workspaceId: string | null, surface: string) {
  return `fizz:uncertain-generation:v1:${JSON.stringify([ownerId, workspaceId, surface])}`;
}

function storage(): Storage {
  if (typeof window === "undefined") throw new Error("Generation recovery storage is unavailable.");
  return window.sessionStorage;
}

export function readGenerationReceipt(key: string): GenerationSubmissionReceipt | null {
  const raw = storage().getItem(key);
  if (!raw) return null;
  const receipt = JSON.parse(raw) as GenerationSubmissionReceipt;
  if (
    receipt.version !== 1 ||
    !receipt.request ||
    typeof receipt.request.idempotencyKey !== "string" ||
    !receipt.request.idempotencyKey ||
    typeof receipt.request.modelId !== "string" ||
    !receipt.request.modelId ||
    typeof receipt.request.schemaVersion !== "string" ||
    !receipt.request.input ||
    typeof receipt.request.input !== "object" ||
    !receipt.request.context ||
    typeof receipt.request.context.documentBlockId !== "string"
  ) {
    // Do not silently erase an unreadable receipt and permit another paid job.
    throw new Error(
      "The saved generation receipt could not be read. Keep it for support before creating another job."
    );
  }
  return receipt;
}

export function saveGenerationReceipt(key: string, receipt: GenerationSubmissionReceipt): void {
  const previous = readGenerationReceipt(key);
  if (previous && JSON.stringify(previous.request) !== JSON.stringify(receipt.request)) {
    throw new Error("Resolve the previous generation request before creating another job.");
  }
  // Write before sending. A full/disabled browser store must not allow an
  // unrecorded charged command whose response could subsequently be lost.
  storage().setItem(key, JSON.stringify(receipt));
}

export function clearGenerationReceipt(key: string, requestKey: string): void {
  const previous = readGenerationReceipt(key);
  if (previous?.request.idempotencyKey === requestKey) storage().removeItem(key);
}
