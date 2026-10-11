import { z } from "zod";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";
import { StoryScreenplayDocumentSchema } from "@repo/shared/story-agent";
import { ExperienceRuntimeManifestSchema } from "@repo/shared/experience-runtime";

export const ProductionPlanSchema = z
  .object({
    kind: z.literal("production"),
    goal: z.enum(["script", "video", "interactive_film"]),
    firstStage: z.enum(["script", "plot", "assets", "storyboard", "media"]),
    sourceMode: z.enum(["adapt", "preserve"]).optional(),
    mediaTargets: z
      .object({ assetIds: z.array(z.uuid()).max(200), clipIds: z.array(z.uuid()).max(200) })
      .strict()
      .refine(
        (targets) => targets.assetIds.length + targets.clipIds.length > 0,
        "Media targets must identify at least one item."
      )
      .optional(),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4000),
    brief: z.string().trim().min(1).max(7600),
    profile: z
      .object({
        frameProfile: z.enum(["landscape_16_9", "portrait_9_16"]),
        durationPreset: z.enum(["short_5_15", "medium_15_30", "long_30_60"]),
        visualStyle: z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS),
      })
      .strict(),
  })
  .strict();
export const StoryAgentDecisionSchema = z.discriminatedUnion("kind", [
  ProductionPlanSchema,
  z
    .object({
      kind: z.literal("reply"),
      text: z
        .string()
        .trim()
        .min(1)
        .max(8000)
        .refine(
          (text) => !/^[a-z]+(?:_[a-z]+)+$/.test(text),
          "A raw tool name is not an assistant reply."
        ),
    })
    .strict(),
]);
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;
export type StoryAgentDecision = z.infer<typeof StoryAgentDecisionSchema>;
export const PlannerRequestSchema = z
  .object({
    runId: z.uuid(),
    message: z.string().trim().min(1).max(16000),
    locale: z.enum(["en-US", "zh-CN", "zh-HK"]),
    context: z.record(z.string(), z.unknown()),
    history: z
      .array(
        z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(16000) }).strict()
      )
      .max(20),
  })
  .strict();
export type PlannerRequest = z.infer<typeof PlannerRequestSchema>;
export const StartStoryRunSchema = z
  .object({
    submissionId: z.uuid(),
    chapterId: z.uuid(),
    message: z.string().trim().min(1).max(16000),
    authorizedPoints: z.number().int().nonnegative().max(1_000_000),
    documentId: z.uuid().optional(),
    attachmentIds: z.array(z.uuid()).max(5).optional(),
  })
  .strict();
export type StartStoryRun = z.infer<typeof StartStoryRunSchema>;
export const StoryAttachmentSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    bytes: z.number().int().nonnegative(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  })
  .strict();
export type StoryAttachment = z.infer<typeof StoryAttachmentSchema>;
export const StoryConversationSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    pinned: z.boolean(),
    archived: z.boolean(),
    rank: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    inherited: z.array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          text: z.string(),
          createdAt: z.string(),
          id: z.string(),
        })
        .strict()
    ),
  })
  .strict();
export const StoryConversationsSchema = z.array(StoryConversationSchema);
export type StoryConversation = z.infer<typeof StoryConversationSchema>;
export const UpdateStoryConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    beforeId: z.uuid().nullable().optional(),
  })
  .strict();
export const CreateStoryConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    sourceId: z.uuid().optional(),
    atMessageId: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (input) => !input.atMessageId || Boolean(input.sourceId),
    "A fork boundary requires a source conversation."
  );
export const PlannerResponseSchema = z
  .object({
    decision: StoryAgentDecisionSchema,
    events: z.array(z.record(z.string(), z.unknown())).max(500),
  })
  .strict();
export const StoryMediaConfirmationSchema = z
  .object({
    batchId: z.uuid(),
    version: z.number().int().nonnegative(),
    points: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
export type StoryMediaConfirmation = z.infer<typeof StoryMediaConfirmationSchema>;
export const ResumeStoryRunSchema = z
  .object({
    authorizedPoints: StartStoryRunSchema.shape.authorizedPoints.optional(),
    confirmedQuote: StoryMediaConfirmationSchema.optional(),
    refreshQuote: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.refreshQuote || (input.confirmedQuote && input.authorizedPoints === undefined),
    "Refreshing a quote requires its current identity and cannot authorize spending."
  );
export const ChangeStoryVideoModelSchema = z
  .object({
    modelId: z.string().min(1).max(100),
    runVersion: z.number().int().nonnegative(),
    quote: StoryMediaConfirmationSchema,
  })
  .strict();
export type ChangeStoryVideoModel = z.infer<typeof ChangeStoryVideoModelSchema>;
export const StoryVideoModelsSchema = z
  .object({
    selectedModelId: z.string(),
    models: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  })
  .strict();
export type StoryVideoModels = z.infer<typeof StoryVideoModelsSchema>;
export const StoryMediaQuoteSchema = StoryMediaConfirmationSchema.extend({
  imageCount: z.number().int().nonnegative(),
  videoCount: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime(),
  approved: z.boolean(),
  videoModelId: z.string().optional(),
  routeDurationMs: z.number().int().positive().nullable().optional(),
}).strict();
export const StoryRunSchema = z
  .object({
    version: z.number().int().nonnegative(),
    id: z.uuid(),
    submissionId: z.uuid(),
    chapterId: z.uuid(),
    message: z.string(),
    status: z.enum([
      "queued",
      "planning",
      "producing",
      "blocked",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
    ]),
    phase: z.string(),
    assistantText: z.string().nullable(),
    historyIndex: z.number().int().nonnegative().optional(),
    harnessEvents: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
    attachments: z.array(StoryAttachmentSchema).optional(),
    authorizedPoints: z.number().int().nonnegative(),
    committedPoints: z.number().int().nonnegative(),
    requiredPoints: z.number().int().nonnegative().nullable(),
    mediaQuote: StoryMediaQuoteSchema.nullable().optional(),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
    result: z
      .object({
        kind: z.enum(["script", "video", "interactive_film"]),
        title: z.string(),
        previewPath: z.string().nullable(),
      })
      .nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type StoryRun = z.infer<typeof StoryRunSchema>;
export const StoryTokenUsageSchema = z
  .object({
    uncachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
  })
  .strict();
export const StoryHistorySchema = z
  .object({
    runs: z.array(StoryRunSchema),
    nextCursor: z.uuid().nullable().optional(),
    usageByChapter: z.record(z.string(), StoryTokenUsageSchema).optional(),
    legacyMessages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["user", "assistant"]),
          text: z.string(),
          createdAt: z.string(),
        })
        .strict()
    ),
    legacyActiveRunId: z.uuid().nullable(),
    authorizationLimit: z.number().int().nonnegative(),
  })
  .strict();
export type StoryHistory = z.infer<typeof StoryHistorySchema>;
export const StoryDocumentSchema = z.object({ documentId: z.uuid(), name: z.string() });

/** Selected chapter media, or stable generation cards scoped to one accepted run. */
export const StoryOutputsSchema = z.array(
  z
    .object({
      id: z.uuid(),
      kind: z.enum(["image", "video"]),
      title: z.string(),
      status: z.enum(["queued", "generating", "ready", "failed", "cancelled"]),
      url: z
        .url()
        .refine((value) => new URL(value).protocol === "https:", "Media must use HTTPS.")
        .nullable(),
      posterUrl: z.url().nullable(),
      /** Planned timeline duration; null for images or unavailable timing. */
      durationMs: z.number().int().positive().nullable(),
      error: z.string().nullable(),
    })
    .strict()
    .refine(
      (media) => media.status !== "ready" || media.url !== null,
      "Ready media requires an output URL."
    )
);
export type StoryOutputs = z.infer<typeof StoryOutputsSchema>;

/** Current saved chapter text, read from the canonical collaborative document. */
export const StoryScriptSchema = z
  .object({
    documentId: z.uuid(),
    sequence: z.number().int().nonnegative(),
    document: StoryScreenplayDocumentSchema,
  })
  .strict()
  .nullable();
export type StoryScript = z.infer<typeof StoryScriptSchema>;

/** Authorized canonical working preview, ready for the shared player. */
export const StoryPreviewSchema = z
  .object({
    runtime: ExperienceRuntimeManifestSchema,
    coverUrl: z.url().nullable(),
    contentHash: z.string().min(1),
  })
  .strict();
export type StoryPreview = z.infer<typeof StoryPreviewSchema>;
