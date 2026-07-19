/**
 * Send-time document upload for the Story Canvas Director Agent.
 *
 * Mirrors the direct-fetch convention of the other Copilot endpoints (raw
 * JSON body, no `{code,data}` envelope, satoken cookie via same-origin
 * credentials, explicit workspace header).
 */
import { CopilotDocumentRefSchema, type CopilotDocumentRef } from "@repo/shared/copilot-documents";

const COPILOT_DOCUMENTS_API = "/aurora/copilot/documents";

export class CopilotDocumentUploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CopilotDocumentUploadError";
  }
}

export async function uploadCopilotDocument({
  file,
  conversationId,
  projectId,
  workspaceId,
  signal,
}: {
  file: File;
  conversationId: string;
  projectId: string;
  workspaceId: string | null;
  signal?: AbortSignal;
}): Promise<CopilotDocumentRef> {
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("conversationId", conversationId);
  body.append("projectId", projectId);
  body.append("mode", "story-canvas");

  let response: Response;
  try {
    response = await fetch(COPILOT_DOCUMENTS_API, {
      method: "POST",
      credentials: "include",
      headers: workspaceId ? { "x-fizz-workspace-id": workspaceId } : {},
      body,
      signal,
    });
  } catch (caught) {
    if (signal?.aborted) throw caught;
    throw new CopilotDocumentUploadError(
      "The document upload failed to reach the server.",
      "NETWORK_ERROR",
      0
    );
  }
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = `Document upload failed (HTTP ${response.status}).`;
    try {
      const payload = (await response.json()) as { code?: unknown; message?: unknown };
      if (typeof payload.code === "string" && payload.code) code = payload.code;
      if (typeof payload.message === "string" && payload.message) message = payload.message;
    } catch {
      // Keep the HTTP fallback.
    }
    throw new CopilotDocumentUploadError(message, code, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CopilotDocumentUploadError(
      "The document upload response was not valid JSON.",
      "CONTRACT_ERROR",
      response.status
    );
  }
  const parsed = CopilotDocumentRefSchema.safeParse((payload as { document?: unknown })?.document);
  if (!parsed.success) {
    throw new CopilotDocumentUploadError(
      "The document upload response did not match the expected contract.",
      "CONTRACT_ERROR",
      response.status
    );
  }
  return parsed.data;
}
