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

export const TextGameIdSchema = z.string().regex(/^tg_[A-Za-z0-9]{16}$/);
export const TextGameSessionIdSchema = z.string().regex(/^ts_[A-Za-z0-9]{16}$/);

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
  gameId: TextGameIdSchema,
  name: NullableTextSchema,
  posterUrl: NullableTextSchema,
  synopsis: NullableTextSchema,
  status: TextGameStatusSchema,
  updatedAt: z.string().default(""),
});
export type TextGameSummary = z.infer<typeof TextGameSummarySchema>;
export const TextGameSummaryListSchema = z.array(TextGameSummarySchema);

export const TextGameAdminStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  draft: z.number().int().nonnegative(),
  reviewing: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  offline: z.number().int().nonnegative(),
});
export type TextGameAdminStats = z.infer<typeof TextGameAdminStatsSchema>;

export const TextGameAdminListSchema = z.object({
  list: TextGameSummaryListSchema,
  stats: TextGameAdminStatsSchema,
  total: z.number().int().nonnegative(),
});
export type TextGameAdminList = z.infer<typeof TextGameAdminListSchema>;

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
  gameId: TextGameIdSchema,
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
  sessionId: TextGameSessionIdSchema,
  gameId: TextGameIdSchema,
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
  sessionId: TextGameSessionIdSchema,
  userMessage: TextGameMessageSchema.extend({ role: z.literal("user") }),
  assistantMessage: TextGameMessageSchema.extend({ role: z.literal("assistant") }),
});
export type TextGameChatResponse = z.infer<typeof TextGameChatResponseSchema>;

export const TextGameChatInputSchema = z.object({
  message: z.string().trim().min(1),
});
export type TextGameChatInput = z.infer<typeof TextGameChatInputSchema>;

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

export const TextGameUpdateInputSchema = z.object({
  name: z.string().optional(),
  posterUrl: z.string().url().optional(),
  synopsis: z.string().optional(),
  worldviewDocxUrl: z.string().url().optional(),
  bgmUrl: z.union([z.string().url(), z.literal("")]).optional(),
  stillUrls: z.array(z.string().url()).optional(),
});
export type TextGameUpdateInput = z.infer<typeof TextGameUpdateInputSchema>;

export const TextGameCreatorActionSchema = z.enum(["submit", "offline"]);
export type TextGameCreatorAction = z.infer<typeof TextGameCreatorActionSchema>;

export const TextGameAdminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1) }),
  z.object({ action: z.literal("force_offline") }),
]);
export type TextGameAdminAction = z.infer<typeof TextGameAdminActionSchema>;

export function isTextGameEditableByCreator(status: TextGameStatus): boolean {
  return status !== "reviewing";
}

export function isTextGameCreatorActionAllowed(
  status: TextGameStatus,
  action: TextGameCreatorAction
): boolean {
  if (action === "submit") return status !== "reviewing";
  return status === "published" || status === "reviewing";
}

export function textGameStatusAfterCreatorAction(action: TextGameCreatorAction): TextGameStatus {
  return action === "submit" ? "reviewing" : "offline";
}

export function isTextGameAdminActionAllowed(
  status: TextGameStatus,
  action: TextGameAdminAction["action"]
): boolean {
  if (action === "approve" || action === "reject") return status === "reviewing";
  return status === "published" || status === "reviewing";
}

export function textGameStatusAfterAdminAction(
  action: TextGameAdminAction["action"]
): TextGameStatus {
  if (action === "approve") return "published";
  if (action === "reject") return "draft";
  return "offline";
}

export function parseTextGameList(input: unknown): TextGameSummary[] {
  return TextGameSummaryListSchema.parse(input);
}

export function parseTextGameDetail(input: unknown): TextGameDetail {
  return TextGameDetailSchema.parse(input);
}
