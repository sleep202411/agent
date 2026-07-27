import { z } from "zod";

/**
 * Copilot document attachments (Story Canvas Director Agent).
 *
 * A creator uploads a script/outline at send time; the server extracts plain
 * text once, stores it durably scoped to the conversation, and the chat
 * message carries only this small reference part. The extracted text itself
 * never rides a client payload — the server injects it into model context and
 * threads the documentId onto the durable authoring run.
 */

/** UIMessage part type for a document reference (`data-*` = UI data part). */
export const COPILOT_DOCUMENT_PART_TYPE = "data-document" as const;

export const COPILOT_DOCUMENT_MEDIA_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
] as const;
export type CopilotDocumentMediaType = (typeof COPILOT_DOCUMENT_MEDIA_TYPES)[number];

/** Accepted upload extensions, lowercase, in v1 (no pdf). */
export const COPILOT_DOCUMENT_EXTENSIONS = [".docx", ".md", ".txt"] as const;

export const COPILOT_DOCUMENT_MEDIA_TYPE_BY_EXTENSION: Readonly<
  Record<(typeof COPILOT_DOCUMENT_EXTENSIONS)[number], CopilotDocumentMediaType>
> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

/** Hard cap on the uploaded file itself. */
export const COPILOT_DOCUMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Cap on the extracted text, aligned with the existing model budgets: the
 * Copilot model-input ceiling is 512KB of serialized bytes and the authoring
 * context ceiling is 200K characters. 100K characters (≤ ~300KB as UTF-8 CJK)
 * leaves headroom for the system prompt, story context, and history in both.
 */
export const COPILOT_DOCUMENT_MAX_TEXT_CHARS = 100_000;

/** Documents one conversation may accumulate (append-only rows). */
export const COPILOT_DOCUMENT_MAX_PER_CONVERSATION = 20;

/**
 * The reference carried by a `data-document` user-message part and returned by
 * the upload endpoint. Strict: the server re-verifies every field against the
 * durable row before a turn is accepted.
 */
export const CopilotDocumentRefSchema = z
  .object({
    documentId: z.uuid(),
    name: z.string().trim().min(1).max(255),
    mediaType: z.enum(COPILOT_DOCUMENT_MEDIA_TYPES),
    sizeBytes: z.number().int().positive().max(COPILOT_DOCUMENT_MAX_FILE_BYTES),
    charCount: z.number().int().positive().max(COPILOT_DOCUMENT_MAX_TEXT_CHARS),
  })
  .strict();
export type CopilotDocumentRef = z.infer<typeof CopilotDocumentRefSchema>;

/** A full `data-document` UI message part. */
export const CopilotDocumentPartSchema = z
  .object({
    type: z.literal(COPILOT_DOCUMENT_PART_TYPE),
    data: CopilotDocumentRefSchema,
  })
  .strict();
export type CopilotDocumentPart = z.infer<typeof CopilotDocumentPartSchema>;

export function isCopilotDocumentPart(part: unknown): part is CopilotDocumentPart {
  return CopilotDocumentPartSchema.safeParse(part).success;
}

/** Document refs carried by one UI message, in part order. */
export function copilotDocumentRefsFromParts(parts: readonly unknown[]): CopilotDocumentRef[] {
  const refs: CopilotDocumentRef[] = [];
  for (const part of parts) {
    const parsed = CopilotDocumentPartSchema.safeParse(part);
    if (parsed.success) refs.push(parsed.data.data);
  }
  return refs;
}
