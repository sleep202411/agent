import { z } from "zod";

/**
 * Java text-game contract shared by the player and creator studio.
 *
 * Java documents several identifiers as `long`, while real examples return
 * message ids as strings. Normalize both wire representations to strings at
 * the boundary so callers never perform unsafe numeric coercion.
 */
export const TextGameWireIdSchema = z
  .union([z.string(), z.number().int().safe()])
  .transform((value) => String(value));

export const TextGameStatusSchema = z.enum(["draft", "reviewing", "published", "offline"]);
export type TextGameStatus = z.infer<typeof TextGameStatusSchema>;

const NullableTextSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const EmptyTextSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? "");

export const TextGameCharacterSchema = z.object({
  id: TextGameWireIdSchema,
  name: EmptyTextSchema,
  intro: EmptyTextSchema,
  avatarUrl: NullableTextSchema,
  sortOrder: z.number().int().default(0),
});
export type TextGameCharacter = z.infer<typeof TextGameCharacterSchema>;

export const TextGameSummarySchema = z.object({
  gameId: z.string().min(1),
  name: NullableTextSchema,
  posterUrl: NullableTextSchema,
  synopsis: NullableTextSchema,
  status: TextGameStatusSchema,
  updatedAt: z.string().default(""),
});
export type TextGameSummary = z.infer<typeof TextGameSummarySchema>;
export const TextGameSummaryListSchema = z.array(TextGameSummarySchema);

export const TextGameVersionContentSchema = z.object({
  versionId: TextGameWireIdSchema,
  versionNo: z.number().int().nonnegative(),
  name: NullableTextSchema,
  posterUrl: NullableTextSchema,
  synopsis: NullableTextSchema,
  worldviewDocxUrl: NullableTextSchema,
  bgmUrl: NullableTextSchema,
  characters: z
    .array(TextGameCharacterSchema)
    .nullish()
    .transform((value) => value ?? []),
  stillUrls: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
});
export type TextGameVersionContent = z.infer<typeof TextGameVersionContentSchema>;

export const TextGameDetailSchema = z.object({
  gameId: z.string().min(1),
  projectId: NullableTextSchema,
  status: TextGameStatusSchema,
  rejectReason: NullableTextSchema,
  draftVersionId: TextGameWireIdSchema,
  publishedVersionId: TextGameWireIdSchema.nullable()
    .optional()
    .transform((value) => value ?? null),
  publishedAt: NullableTextSchema,
  offlineAt: NullableTextSchema,
  createdAt: z.string().default(""),
  updatedAt: z.string().default(""),
  content: TextGameVersionContentSchema,
});
export type TextGameDetail = z.infer<typeof TextGameDetailSchema>;

export const TextGameMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export type TextGameMessageRole = z.infer<typeof TextGameMessageRoleSchema>;

export const TextGameMessageSchema = z.object({
  id: TextGameWireIdSchema,
  role: TextGameMessageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type TextGameMessage = z.infer<typeof TextGameMessageSchema>;

export const TextGamePlaySessionSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  resumed: z.boolean(),
  bgmUrl: NullableTextSchema,
  stillUrls: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  messages: z
    .array(TextGameMessageSchema)
    .nullish()
    .transform((value) => value ?? []),
  startedAt: z.string(),
});
export type TextGamePlaySession = z.infer<typeof TextGamePlaySessionSchema>;

export const TextGameChatResponseSchema = z.object({
  sessionId: z.string().min(1),
  userMessage: TextGameMessageSchema,
  assistantMessage: TextGameMessageSchema,
});
export type TextGameChatResponse = z.infer<typeof TextGameChatResponseSchema>;

export const TextGameCreateInputSchema = z.object({
  worldviewDocxUrl: z.string().url(),
  name: z.string().optional(),
  posterUrl: z.string().url().optional(),
  synopsis: z.string().optional(),
  projectId: z.string().optional(),
  bgmUrl: z.string().url().optional(),
  stillUrls: z.array(z.string().url()).optional(),
});
export type TextGameCreateInput = z.infer<typeof TextGameCreateInputSchema>;

export const TextGameUpdateInputSchema = TextGameCreateInputSchema.partial();
export type TextGameUpdateInput = z.infer<typeof TextGameUpdateInputSchema>;

export function parseTextGameList(input: unknown): TextGameSummary[] {
  return TextGameSummaryListSchema.parse(input);
}

export function parseTextGameDetail(input: unknown): TextGameDetail {
  return TextGameDetailSchema.parse(input);
}
