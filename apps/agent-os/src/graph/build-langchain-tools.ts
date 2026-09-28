import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { requiresApproval, type AgentMode, type PermissionMode } from "@repo/agent-policy";
import {
  buildToolIdempotencyKey,
  agentExternalJobHandoffFromResult,
  getTool,
  parseToolInput,
  parseToolOutput,
  type DomainPort,
  type StoryProductionContinuationPlan,
  type StoryProductionTargetStage,
} from "@repo/agent-tools";
import { STORY_VISUAL_STYLE_SKILL_SLUGS } from "@repo/shared";
import { STORY_PATCH_OPERATION_LABELS } from "@repo/shared/story-agent";
import {
  MAX_STORY_STATE_EFFECTS,
  MAX_STORY_STATE_NOTE_LENGTH,
  MAX_STORY_STATE_VARIABLES,
  STORY_STATE_KEY_PATTERN,
} from "@repo/shared/story-stats";
import { z } from "zod/v3";

import { toLangChainToolName } from "./tool-name.js";

export interface ToolRuntimeContext {
  runId: string;
  turnId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  skillResolutionId: string;
  skillVersionIds: readonly string[];
  workbenchContext?: Readonly<Record<string, string>>;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  domain: DomainPort;
  startExecution?: {
    executionToken: string;
    executionAttemptId: string;
    executionEpoch: number;
    executionOwnerId: string;
  };
  continuationExecution?: {
    executionToken: string;
    executionAttemptId: string;
    executionEpoch: number;
    executionOwnerId: string;
  };
  /**
   * Trusted post-approval production scope. When present, the graph—not the
   * model—owns the next story.author arguments and lifecycle copy.
   */
  storyContinuation?: {
    responseId: string;
    locale: "en-US" | "zh-CN" | "zh-HK";
    plan: StoryProductionContinuationPlan;
    completedStage?: StoryProductionTargetStage;
    mediaBatchCompleted?: boolean;
  };
  /** Cancels an in-flight Domain receipt poll when the creator stops the run. */
  abortSignal?: AbortSignal;
  /** Journal fan-out for ToolStarted / ToolCompleted / ToolFailed. */
  onToolEvent?: (event: {
    type: "ToolStarted" | "ToolCompleted" | "ToolFailed";
    toolId: string;
    toolCallId: string;
    data?: Record<string, unknown>;
  }) => void | Promise<void>;
}

export type ApprovalInterruptValue = {
  kind: "tool_approval";
  approvalId: string;
  turnId: string;
  toolId: string;
  toolCallId: string;
  arguments: unknown;
  title: string;
  description: string;
};

export type UserInputInterruptValue = {
  kind: "user_input";
  requestId: string;
  turnId: string;
  toolCallId: string;
  leadIn: string;
  resumeAcknowledgement: string;
  formId?: string;
  knownValues?: Record<string, string>;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options: Array<{ value: string; label: string; description?: string }>;
  }>;
};

/**
 * Reconstruct the complete structured answer returned to the model.
 *
 * The transcript keeps only what the creator actually answered. The tool
 * result additionally restores server-validated values already known before
 * the pause, so the next model step cannot forget them or overwrite them with
 * an unexpected resume payload.
 */
export function userInputResumePayload(
  knownValues: Readonly<Record<string, string>> | undefined,
  response: { requestId: string; answers?: Readonly<Record<string, string>> }
): { requestId: string; answers: Record<string, string> } {
  return {
    requestId: response.requestId,
    answers: {
      ...(response.answers ?? {}),
      ...(knownValues ?? {}),
    },
  };
}

/**
 * Bind registry tools into LangChain StructuredTools for the mounted skill set.
 * Sensitive commands use LangGraph `interrupt()` for product approval (HITL).
 * Tools not listed in the skill mount are never bound — the model cannot call them.
 */
export function buildLangChainTools(runtime: ToolRuntimeContext, toolIds: readonly string[]) {
  const userInputKey = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
  const requestUserInput = tool(
    async (raw, config) => {
      const parsed = parseToolInput("request_user_input", raw) as Omit<
        UserInputInterruptValue,
        "kind" | "requestId" | "turnId" | "toolCallId"
      >;
      const response = interrupt({
        kind: "user_input",
        requestId: crypto.randomUUID(),
        turnId: runtime.turnId,
        toolCallId: toolCallIdFromConfig(config) ?? crypto.randomUUID(),
        leadIn: parsed.leadIn,
        resumeAcknowledgement: parsed.resumeAcknowledgement,
        ...(parsed.formId ? { formId: parsed.formId } : {}),
        ...(parsed.knownValues ? { knownValues: parsed.knownValues } : {}),
        questions: parsed.questions,
      } satisfies UserInputInterruptValue) as {
        requestId: string;
        answers?: Record<string, string>;
      };
      return JSON.stringify(userInputResumePayload(parsed.knownValues, response));
    },
    {
      name: toLangChainToolName("request_user_input"),
      description: getTool("request_user_input").description,
      schema: z.object({
        leadIn: z.string().trim().min(1).max(1_000),
        resumeAcknowledgement: z.string().trim().min(1).max(1_000),
        formId: userInputKey.optional(),
        knownValues: z
          .object({
            aspect_ratio: z.enum(["portrait_9_16", "landscape_16_9"]).optional(),
            target_runtime: z.enum(["short_5_15", "medium_15_30", "long_30_60"]).optional(),
            visual_direction: z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS).optional(),
            story_language: z.enum(["zh-CN", "zh-HK", "en-US"]).optional(),
          })
          .strict()
          .optional(),
        questions: z
          .array(
            z.object({
              id: userInputKey,
              header: z.string().trim().min(1).max(40),
              question: z.string().trim().min(1).max(500),
              options: z
                .array(
                  z.object({
                    value: userInputKey,
                    label: z.string().trim().min(1).max(80),
                    description: z.string().trim().min(1).max(180).optional(),
                  })
                )
                .min(2)
                .max(12),
            })
          )
          .min(1)
          .max(4)
          .optional(),
      }),
    }
  );

  const storeScript = tool(
    async (raw, config) => {
      return executeBound("script.store", raw, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("script.store"),
      description: getTool("script.store").description,
      schema: z.object({
        text: z.string().min(1).max(1_000_000),
        sectionSize: z.number().int().positive().max(50_000).optional(),
      }),
    }
  );

  const readSection = tool(
    async (raw, config) => {
      return executeBound("script.readSection", raw, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("script.readSection"),
      description: getTool("script.readSection").description,
      schema: z.object({
        attachmentId: z.string().uuid(),
        sectionIndex: z.number().int().nonnegative(),
        maxChars: z.number().int().positive().max(50_000).optional(),
      }),
    }
  );

  const listCharacters = tool(
    async (raw, config) => {
      return executeBound("characters.list", raw ?? {}, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("characters.list"),
      description: getTool("characters.list").description,
      schema: z.object({}),
    }
  );

  const upsertCharacters = tool(
    async (raw, config) => {
      return executeBound("characters.upsert", raw, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("characters.upsert"),
      description: getTool("characters.upsert").description,
      schema: z.object({
        baseRevision: z.number().int().nonnegative(),
        characters: z
          .array(
            z.object({
              id: z.string().min(1),
              name: z.record(z.string()),
              summary: z.string().min(1),
              intent: z.enum(["create", "replace"]).optional(),
            })
          )
          .min(1)
          .max(100),
      }),
    }
  );

  const listShots = tool(
    async (raw, config) => {
      return executeBound("storyboard.listShots", raw ?? {}, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("storyboard.listShots"),
      description: getTool("storyboard.listShots").description,
      schema: z.object({}),
    }
  );

  const upsertShots = tool(
    async (raw, config) => {
      return executeBound("storyboard.upsertShots", raw, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("storyboard.upsertShots"),
      description: getTool("storyboard.upsertShots").description,
      schema: z.object({
        baseRevision: z.number().int().nonnegative(),
        shots: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().min(1),
              prompt: z.string().min(1),
              notes: z.string().optional(),
              intent: z.enum(["create", "replace"]).optional(),
            })
          )
          .min(1)
          .max(200),
      }),
    }
  );

  const deleteShots = tool(
    async (raw, config) => {
      return executeBound("storyboard.deleteShots", raw, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("storyboard.deleteShots"),
      description: getTool("storyboard.deleteShots").description,
      schema: z.object({
        baseRevision: z.number().int().nonnegative(),
        shotIds: z.array(z.string().min(1)).min(1).max(200),
      }),
    }
  );

  const canvasRead = tool(
    async (raw, config) => {
      return executeBound("canvas.read", raw ?? {}, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("canvas.read"),
      description: getTool("canvas.read").description,
      schema: z.object({}),
    }
  );

  const canvasApplyPatch = tool(
    async (raw, config) => {
      // Coerce operationIds before registry parse — models invent invalid UUIDs.
      const body =
        raw && typeof raw === "object"
          ? {
              ...(raw as Record<string, unknown>),
              operations: Array.isArray((raw as { operations?: unknown }).operations)
                ? (raw as { operations: Array<Record<string, unknown>> }).operations.map((op) => {
                    const id = op?.operationId;
                    const ok =
                      typeof id === "string" &&
                      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                        id
                      );
                    return {
                      ...op,
                      operationId: ok ? id : crypto.randomUUID(),
                    };
                  })
                : (raw as { operations?: unknown }).operations,
            }
          : raw;
      return executeBound("canvas.applyPatch", body, runtime, toolCallIdFromConfig(config));
    },
    {
      name: toLangChainToolName("canvas.applyPatch"),
      description: getTool("canvas.applyPatch").description,
      schema: z.object({
        baseDraftRevision: z.number().int().nonnegative(),
        baseLayoutRevision: z.number().int().nonnegative(),
        title: z.string().optional(),
        summary: z.string().optional(),
        operations: z
          .array(
            z.object({
              // Optional: server / executeBound mints a real UUID if missing/invalid.
              operationId: z.string().optional(),
              kind: z.string().min(1),
              payload: z.record(z.unknown()),
            })
          )
          .min(1)
          .max(100),
      }),
    }
  );

  const storyStableId = z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
  const storyLocalizedText = z.record(z.string().min(2).max(16), z.string().max(4_000));
  const storyClipKey = z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_-]*$/);
  const storyStateKey = z.string().min(1).max(240).regex(STORY_STATE_KEY_PATTERN);
  const storyStateEffect = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("set"),
      key: storyStateKey,
      value: z.union([z.number(), z.boolean()]),
    }),
    z.object({ kind: z.literal("add"), key: storyStateKey, amount: z.number() }),
  ]);
  const storyStateEffects = z.array(storyStateEffect).max(MAX_STORY_STATE_EFFECTS);
  const storyStateVariableBase = {
    key: storyStateKey,
    name: storyLocalizedText,
    note: z.string().max(MAX_STORY_STATE_NOTE_LENGTH).optional(),
  };
  const storyStateVariable = z.union([
    z.object({
      ...storyStateVariableBase,
      valueType: z.literal("number"),
      initialValue: z.number(),
    }),
    z.object({
      ...storyStateVariableBase,
      valueType: z.literal("boolean"),
      initialValue: z.boolean(),
    }),
  ]);
  const storyScene = z.object({
    nodeId: storyStableId,
    clipKey: storyClipKey,
    name: z.string().max(120).optional(),
    description: z.string().max(4_000).optional(),
  });
  const storyInteractionAction = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("continue"), effects: storyStateEffects.optional() }),
    z.object({ kind: z.literal("pause"), effects: storyStateEffects.optional() }),
    z.object({
      kind: z.literal("seek"),
      timeMs: z.number().int().min(0),
      effects: storyStateEffects.optional(),
    }),
    z.object({
      kind: z.literal("goto"),
      nodeId: storyStableId,
      effects: storyStateEffects.optional(),
    }),
  ]);
  const storyInteractionTrigger = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tap") }),
    z.object({
      kind: z.literal("swipe"),
      direction: z.enum(["up", "down", "left", "right"]),
    }),
    z.object({
      kind: z.literal("press-hold"),
      durationMs: z.number().int().min(300).max(10_000),
    }),
  ]);
  const storyHotspotInteraction = z.object({
    kind: z.literal("hotspot"),
    interactionId: storyStableId,
    label: storyLocalizedText,
    trigger: storyInteractionTrigger,
    rect: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0.001).max(1),
      height: z.number().min(0.001).max(1),
    }),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    branchAtMs: z.number().int().min(1).optional(),
    timing: z.enum(["window", "hold"]).optional(),
    outcomes: z.object({
      success: storyInteractionAction,
      failure: storyInteractionAction.optional(),
      timeout: storyInteractionAction.optional(),
    }),
  });
  const storyBase = { baseDraftRevision: z.number().int().nonnegative() };
  const bindStoryTool = (toolId: string, schema: z.ZodTypeAny) =>
    tool(
      async (raw, config) => executeBound(toolId, raw ?? {}, runtime, toolCallIdFromConfig(config)),
      {
        name: toLangChainToolName(toolId),
        description: getTool(toolId).description,
        schema,
      }
    );

  const storyRead = bindStoryTool("story.read", z.object({}));
  const storyConfirmCreativeProfile = bindStoryTool(
    "story.confirmCreativeProfile",
    z.object({
      requestId: z.string().uuid().optional(),
      aspectRatio: z.enum(["landscape_16_9", "portrait_9_16"]),
      targetRuntime: z.enum(["short_5_15", "medium_15_30", "long_30_60"]),
      visualDirection: z.enum(STORY_VISUAL_STYLE_SKILL_SLUGS),
      storyLanguage: z.enum(["zh-CN", "zh-HK", "en-US"]),
    })
  );
  const storyUpdateBible = bindStoryTool(
    "story.updateBible",
    z.object({
      ...storyBase,
      logline: z.string().max(1_000).optional(),
      synopsis: z.string().max(20_000).optional(),
      // Cast authoring is withdrawn — the canvas offers no way to create
      // character cards, so the agent must not be able to write them back.
      productionNotes: z.array(z.string().max(2_000)).max(200).optional(),
    })
  );
  const storyUpdateStateVariables = bindStoryTool(
    "story.updateStateVariables",
    z.object({
      ...storyBase,
      upsert: z.array(storyStateVariable).max(MAX_STORY_STATE_VARIABLES).default([]),
      removeKeys: z.array(storyStateKey).max(MAX_STORY_STATE_VARIABLES).default([]),
    })
  );
  const storyAddScene = bindStoryTool(
    "story.addScene",
    z.object({
      ...storyBase,
      afterNodeId: storyStableId.nullable().optional(),
      scene: storyScene,
    })
  );
  const storyAddBranch = bindStoryTool(
    "story.addBranch",
    z.object({
      ...storyBase,
      afterNodeId: storyStableId,
      decisionId: storyStableId,
      prompt: storyLocalizedText,
      branches: z
        .array(
          z.object({
            choiceId: storyStableId,
            label: storyLocalizedText,
            scene: storyScene,
          })
        )
        .min(2)
        .max(6),
    })
  );
  const storyEditNode = bindStoryTool(
    "story.editNode",
    z.object({
      ...storyBase,
      nodeId: storyStableId,
      name: z.string().max(120).optional(),
      description: z.string().max(4_000).optional(),
    })
  );
  const storyPutInteraction = bindStoryTool(
    "story.putInteraction",
    z.object({
      ...storyBase,
      nodeId: storyStableId,
      interaction: storyHotspotInteraction,
    })
  );
  const storyRemoveInteraction = bindStoryTool(
    "story.removeInteraction",
    z.object({
      ...storyBase,
      nodeId: storyStableId,
      interactionId: storyStableId,
    })
  );
  const storyRemoveSubtree = bindStoryTool(
    "story.removeSubtree",
    z.object({ ...storyBase, nodeId: storyStableId })
  );
  const storySetEntry = bindStoryTool(
    "story.setEntry",
    z.object({ ...storyBase, nodeId: storyStableId.nullable() })
  );
  const storyReorder = bindStoryTool(
    "story.reorder",
    z.object({ ...storyBase, nodeIds: z.array(storyStableId).max(500) })
  );
  const storyAuthor = bindStoryTool(
    "story.author",
    runtime.storyContinuation
      ? z.object({}).strict()
      : z.object({
          title: z.string().trim().min(1).max(160),
          summary: z.string().trim().min(1).max(4_000),
          brief: z.string().trim().min(1).max(8_000),
          continueThrough: z.enum(["script", "plot", "assets", "storyboard"]),
          sourceAttachmentId: z.string().uuid().optional(),
          regenerateStage: z.enum(["plot", "assets", "storyboard"]).optional(),
          startedMessage: z.string().trim().min(1).max(2_000),
          completionMessage: z.string().trim().min(1).max(2_000),
        })
  );
  const generationOptionValue = z.union([
    z.boolean(),
    z.number(),
    z.string().trim().min(1).max(180),
    z.array(z.union([z.boolean(), z.number(), z.string().trim().min(1).max(180)])).max(32),
  ]);
  const storyQuoteAssetGenerationBatch = bindStoryTool(
    "story.generation.quoteAssets",
    z.object({
      assetIds: z.array(z.string().uuid()).min(1).max(500).optional(),
      assetKinds: z
        .array(z.enum(["character", "location", "prop"]))
        .min(1)
        .max(3)
        .optional(),
      outputKind: z.enum(["image", "video"]).optional(),
      modelId: z.string().trim().min(1).max(180).optional(),
      schemaVersion: z.string().trim().min(1).max(180).optional(),
      options: z.record(generationOptionValue).optional(),
      ...(runtime.storyContinuation?.plan.autoGenerateAssetImages === true
        ? { dispatchMode: z.literal("sequential").optional() }
        : {}),
    })
  );
  const storyQuoteStoryboardGenerationBatch = bindStoryTool(
    "story.generation.quoteStoryboard",
    z.object({
      clipIds: z.array(z.string().uuid()).min(1).max(500).optional(),
      ...(runtime.storyContinuation?.plan.autoGenerateStoryboardMedia === true
        ? { dispatchMode: z.literal("sequential").optional() }
        : {}),
    })
  );
  const storyConfirmGenerationBatch = bindStoryTool(
    "story.generation.confirmBatch",
    z.object({
      batchId: z.string().uuid(),
      expectedVersion: z.number().int().nonnegative(),
      expectedItemCount: z.number().int().positive().max(500),
      expectedTotalPoints: z.number().int().nonnegative(),
    })
  );
  const storyGetGenerationBatch = bindStoryTool(
    "story.generation.getBatch",
    z.object({ batchId: z.string().uuid() })
  );
  const storyCancelGenerationBatch = bindStoryTool(
    "story.generation.cancelBatch",
    z.object({ batchId: z.string().uuid() })
  );
  const storyResumeGenerationBatch = bindStoryTool(
    "story.generation.resumeBatch",
    z.object({ batchId: z.string().uuid() })
  );
  const storyApplyPatch = tool(
    async (raw, config) => {
      const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const operations = Array.isArray(body.operations)
        ? body.operations.map((value) => {
            const operation =
              value && typeof value === "object" ? (value as Record<string, unknown>) : {};
            const kind = operation.kind;
            return {
              ...operation,
              operationId: crypto.randomUUID(),
              summary:
                typeof kind === "string" && kind in STORY_PATCH_OPERATION_LABELS
                  ? STORY_PATCH_OPERATION_LABELS[kind as keyof typeof STORY_PATCH_OPERATION_LABELS]
                  : "Apply a Story graph change.",
            };
          })
        : body.operations;
      return executeBound(
        "story.applyPatch",
        { ...body, operations },
        runtime,
        toolCallIdFromConfig(config)
      );
    },
    {
      name: toLangChainToolName("story.applyPatch"),
      description: getTool("story.applyPatch").description,
      schema: z.object({
        ...storyBase,
        operations: z
          .array(
            z.object({
              kind: z.enum([
                "story_bible.update_overview",
                "story_bible.put_character",
                "story_bible.remove_character",
                "story_bible.put_state_variable",
                "story_bible.remove_state_variable",
                "story_graph.set_entry_node",
                "story_graph.put_node",
                "story_graph.remove_node",
                "story_graph.reorder_nodes",
                "production.replace_notes",
              ]),
              payload: z.record(z.unknown()),
            })
          )
          .min(1)
          .max(200),
      }),
    }
  );

  const storyStoryboardClipInput = z.discriminatedUnion("kind", [
    z.object({
      clipId: z.string().uuid().optional(),
      stableKey: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(4_000).nullable().optional(),
      startMs: z.number().int().min(0).max(3_600_000),
      durationMs: z.number().int().min(250).max(3_600_000),
      negativePrompt: z.string().trim().min(1).max(4_000).nullable().optional(),
      kind: z.literal("image"),
      imagePrompt: z.string().trim().min(1).max(12_000),
    }),
    z.object({
      clipId: z.string().uuid().optional(),
      stableKey: z.string().trim().min(1).max(120),
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().max(4_000).nullable().optional(),
      startMs: z.number().int().min(0).max(3_600_000),
      durationMs: z.number().int().min(250).max(3_600_000),
      negativePrompt: z.string().trim().min(1).max(4_000).nullable().optional(),
      kind: z.literal("video"),
      videoPrompt: z.string().trim().min(1).max(12_000),
    }),
  ]);
  const storyStoryboardRead = bindStoryTool("story.storyboard.read", z.object({}));
  const storyStoryboardPutTimeline = bindStoryTool(
    "story.storyboard.putTimeline",
    z.object({
      sequenceId: z.string().uuid(),
      durationMs: z.number().int().min(0).max(3_600_000),
      clips: z.array(storyStoryboardClipInput).max(1_000),
    })
  );
  const storyStoryboardPatchClip = bindStoryTool(
    "story.storyboard.patchClip",
    z.object({
      clipId: z.string().uuid(),
      kind: z.enum(["image", "video"]).optional(),
      title: z.string().trim().min(1).max(160).optional(),
      description: z.string().trim().max(4_000).nullable().optional(),
      imagePrompt: z.string().trim().min(1).max(12_000).nullable().optional(),
      videoPrompt: z.string().trim().min(1).max(12_000).nullable().optional(),
      negativePrompt: z.string().trim().min(1).max(4_000).nullable().optional(),
    })
  );

  const byRegistryId = {
    request_user_input: requestUserInput,
    "script.store": storeScript,
    "script.readSection": readSection,
    "characters.list": listCharacters,
    "characters.upsert": upsertCharacters,
    "storyboard.listShots": listShots,
    "storyboard.upsertShots": upsertShots,
    "storyboard.deleteShots": deleteShots,
    "canvas.read": canvasRead,
    "canvas.applyPatch": canvasApplyPatch,
    "story.read": storyRead,
    "story.confirmCreativeProfile": storyConfirmCreativeProfile,
    "story.updateBible": storyUpdateBible,
    "story.updateStateVariables": storyUpdateStateVariables,
    "story.addScene": storyAddScene,
    "story.addBranch": storyAddBranch,
    "story.editNode": storyEditNode,
    "story.putInteraction": storyPutInteraction,
    "story.removeInteraction": storyRemoveInteraction,
    "story.removeSubtree": storyRemoveSubtree,
    "story.setEntry": storySetEntry,
    "story.reorder": storyReorder,
    "story.applyPatch": storyApplyPatch,
    "story.storyboard.read": storyStoryboardRead,
    "story.storyboard.putTimeline": storyStoryboardPutTimeline,
    "story.storyboard.patchClip": storyStoryboardPatchClip,
    "story.author": storyAuthor,
    "story.generation.quoteAssets": storyQuoteAssetGenerationBatch,
    "story.generation.quoteStoryboard": storyQuoteStoryboardGenerationBatch,
    "story.generation.confirmBatch": storyConfirmGenerationBatch,
    "story.generation.getBatch": storyGetGenerationBatch,
    "story.generation.cancelBatch": storyCancelGenerationBatch,
    "story.generation.resumeBatch": storyResumeGenerationBatch,
  } as const;

  const allowed = new Set(toolIds);
  const unknown = [...allowed].filter((id) => !Object.hasOwn(byRegistryId, id));
  if (unknown.length > 0) {
    throw new Error(`Skill snapshot requested unknown deployed tool(s): ${unknown.join(", ")}`);
  }
  return [...allowed]
    .map((id) => byRegistryId[id as keyof typeof byRegistryId])
    .filter((t): t is NonNullable<typeof t> => t != null);
}

function toolCallIdFromConfig(config: unknown): string | undefined {
  if (!config || typeof config !== "object") return undefined;
  const toolCall = (config as { toolCall?: { id?: string } }).toolCall;
  return toolCall?.id;
}

async function executeBound(
  toolId: string,
  raw: unknown,
  runtime: ToolRuntimeContext,
  toolCallId: string | undefined
): Promise<string> {
  const definition = getTool(toolId);
  const continuationCopy = runtime.storyContinuation
    ? storyContinuationLifecycleCopy(runtime.storyContinuation.locale, {
        mediaGenerationStarted:
          runtime.storyContinuation.mediaBatchCompleted !== true &&
          ((runtime.storyContinuation.plan.autoGenerateAssetImages === true &&
            runtime.storyContinuation.completedStage === "assets") ||
            (runtime.storyContinuation.plan.autoGenerateStoryboardMedia === true &&
              runtime.storyContinuation.completedStage === "storyboard")),
        mobileH5: runtime.storyContinuation.plan.experience === "mobile_h5",
        completedStage: runtime.storyContinuation.completedStage,
      })
    : null;
  const effectiveRaw =
    toolId === "story.author" && runtime.storyContinuation && continuationCopy
      ? {
          continueThrough: runtime.storyContinuation.plan.continueThrough,
          ...(runtime.storyContinuation.plan.regenerateStage &&
          runtime.storyContinuation.plan.regenerateStage !==
            runtime.storyContinuation.completedStage
            ? { regenerateStage: runtime.storyContinuation.plan.regenerateStage }
            : {}),
          title: runtime.storyContinuation.plan.title,
          summary: runtime.storyContinuation.plan.summary,
          brief: runtime.storyContinuation.plan.brief,
          ...continuationCopy,
        }
      : raw;
  const parsed = parseToolInput(
    toolId,
    toolId === "script.readSection"
      ? {
          ...(effectiveRaw as object),
          maxChars:
            (effectiveRaw as { maxChars?: number }).maxChars === undefined
              ? 8000
              : (effectiveRaw as { maxChars?: number }).maxChars,
        }
      : effectiveRaw
  );

  const callId = toolCallId ?? crypto.randomUUID();
  const emit = runtime.onToolEvent;
  const trustedMobileGeneration =
    toolId === "story.generation.confirmBatch" &&
    runtime.storyContinuation?.mediaBatchCompleted !== true &&
    ((runtime.storyContinuation?.completedStage === "assets" &&
      runtime.storyContinuation.plan.autoGenerateAssetImages === true) ||
      (runtime.storyContinuation?.completedStage === "storyboard" &&
        runtime.storyContinuation.plan.autoGenerateStoryboardMedia === true));
  const gate = trustedMobileGeneration
    ? { required: false as const, reason: "Authorized by the trusted H5 Continue decision." }
    : requiresApproval({
        mode: runtime.agentMode,
        permissionMode: runtime.permissionMode,
        risk: definition.risk,
      });

  if (gate.required) {
    if (runtime.agentMode === "DISCUSS" && definition.risk !== "read") {
      const denied = {
        ok: false as const,
        code: "DISCUSS_WRITE_FORBIDDEN",
        message: gate.reason,
      };
      await emit?.({
        type: "ToolFailed",
        toolId,
        toolCallId: callId,
        data: { code: denied.code, message: denied.message, retryable: false },
      });
      return JSON.stringify(denied);
    }
    const decision = interrupt({
      kind: "tool_approval",
      approvalId: crypto.randomUUID(),
      turnId: runtime.turnId,
      toolId,
      toolCallId: callId,
      arguments: parsed,
      title: `Approve ${toolId}`,
      description: gate.reason,
    } satisfies ApprovalInterruptValue) as { decision?: string } | string;

    const approved =
      decision === "approve" || (typeof decision === "object" && decision?.decision === "approve");
    if (!approved) {
      const rejected = {
        ok: false as const,
        code: "APPROVAL_REJECTED",
        message: "User rejected the tool call.",
      };
      await emit?.({
        type: "ToolFailed",
        toolId,
        toolCallId: callId,
        data: { code: rejected.code, message: rejected.message, retryable: false },
      });
      return JSON.stringify(rejected);
    }
  }

  await emit?.({
    type: "ToolStarted",
    toolId,
    toolCallId: callId,
    data: {},
  });

  try {
    const result = await runtime.domain.execute(toolId, parsed, {
      runId: runtime.runId,
      turnId: runtime.turnId,
      conversationId: runtime.conversationId,
      projectId: runtime.projectId,
      actorId: runtime.actorId,
      skillResolutionId: runtime.skillResolutionId,
      skillVersionIds: runtime.skillVersionIds,
      workbenchContext: runtime.workbenchContext,
      toolCallId: callId,
      idempotencyKey: buildToolIdempotencyKey({
        projectId: runtime.projectId,
        runId: runtime.runId,
        toolCallId: callId,
      }),
      startExecution: runtime.startExecution,
      continuationExecution: runtime.continuationExecution,
      abortSignal: runtime.abortSignal,
    });

    if (result && typeof result === "object" && "ok" in result && result.ok === false) {
      const failed = result as {
        ok: false;
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      await emit?.({
        type: "ToolFailed",
        toolId,
        toolCallId: callId,
        data: {
          code: failed.code ?? "TOOL_FAILED",
          message: failed.message ?? "Tool failed",
          retryable: Boolean(failed.retryable),
        },
      });
    } else {
      const rawData =
        result && typeof result === "object" && "data" in result
          ? (result as { data: unknown }).data
          : result;
      const data = parseToolOutput(toolId, rawData);
      const agentHandoff = agentExternalJobHandoffFromResult(data);
      await emit?.({
        type: "ToolCompleted",
        toolId,
        toolCallId: callId,
        data: {
          result:
            data && typeof data === "object" && !Array.isArray(data)
              ? (data as Record<string, unknown>)
              : { value: data },
          ...(agentHandoff ? { agentHandoff } : {}),
        },
      });
    }

    return JSON.stringify(result);
  } catch (error) {
    if (error instanceof Error && error.name === "AgentOsExecutionSupersededError") {
      // The database lease moved to another Worker. Do not emit ToolFailed and
      // do not return a ToolMessage: either would pollute the shared
      // checkpoint with a stale owner's invented outcome.
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await emit?.({
      type: "ToolFailed",
      toolId,
      toolCallId: callId,
      data: { code: "TOOL_EXCEPTION", message, retryable: true },
    });
    throw error;
  }
}

function storyContinuationLifecycleCopy(
  locale: "en-US" | "zh-CN" | "zh-HK",
  input: {
    mediaGenerationStarted: boolean;
    mobileH5: boolean;
    completedStage?: StoryProductionTargetStage;
  }
) {
  const { mediaGenerationStarted, mobileH5, completedStage } = input;
  if (locale === "zh-CN") {
    if (mediaGenerationStarted) {
      return {
        startedMessage: "正在按故事顺序逐项生成。",
        completionMessage: "本阶段媒体已全部生成。",
      };
    }
    if (mobileH5) {
      if (completedStage === "script") {
        return {
          startedMessage: "正在构建情节树。",
          completionMessage: "情节树已构建，请选择「继续」或「不继续」。",
        };
      }
      if (completedStage === "plot") {
        return {
          startedMessage: "正在构建角色、场景和道具资产。",
          completionMessage: "资产规格已构建。",
        };
      }
      if (completedStage === "assets") {
        return {
          startedMessage: "资产图片已生成，正在构建分镜。",
          completionMessage: "分镜已准备好，请选择「继续」或「不继续」。",
        };
      }
      return {
        startedMessage: "正在继续创作。",
        completionMessage: "下一阶段已准备好，请选择「继续」或「不继续」。",
      };
    }
    return {
      startedMessage: "已开始准备下一份可审核的制作规格；本阶段不会生成任何图片或视频。",
      completionMessage: "下一份制作规格提案已准备好供你审核；本阶段没有生成任何图片或视频。",
    };
  }
  if (locale === "zh-HK") {
    if (mediaGenerationStarted) {
      return {
        startedMessage: "正在按故事順序逐項生成。",
        completionMessage: "本階段媒體已全部生成。",
      };
    }
    if (mobileH5) {
      if (completedStage === "script") {
        return {
          startedMessage: "正在構建情節樹。",
          completionMessage: "情節樹已構建，請選擇「繼續」或「不繼續」。",
        };
      }
      if (completedStage === "plot") {
        return {
          startedMessage: "正在構建角色、場景和道具資產。",
          completionMessage: "資產規格已構建。",
        };
      }
      if (completedStage === "assets") {
        return {
          startedMessage: "資產圖片已生成，正在構建分鏡。",
          completionMessage: "分鏡已準備好，請選擇「繼續」或「不繼續」。",
        };
      }
      return {
        startedMessage: "正在繼續創作。",
        completionMessage: "下一階段已準備好，請選擇「繼續」或「不繼續」。",
      };
    }
    return {
      startedMessage: "已開始準備下一份可審核的製作規格；本階段不會生成任何圖片或影片。",
      completionMessage: "下一份製作規格提案已準備好供你審核；本階段沒有生成任何圖片或影片。",
    };
  }
  if (mediaGenerationStarted) {
    return {
      startedMessage: "Generating one item at a time in story order.",
      completionMessage: "All media for this stage is ready.",
    };
  }
  if (mobileH5) {
    if (completedStage === "script") {
      return {
        startedMessage: "Building the Plot Tree.",
        completionMessage: "The Plot Tree is ready. Choose Continue or Don’t continue.",
      };
    }
    if (completedStage === "plot") {
      return {
        startedMessage: "Building Character, Location, and Prop Assets.",
        completionMessage: "The Asset Specs are ready.",
      };
    }
    if (completedStage === "assets") {
      return {
        startedMessage: "Asset images are ready. Building the Storyboard.",
        completionMessage: "The Storyboard is ready. Choose Continue or Don’t continue.",
      };
    }
    return {
      startedMessage: "Continuing creation.",
      completionMessage: "The next stage is ready. Choose Continue or Don’t continue.",
    };
  }
  return {
    startedMessage:
      "I’m preparing the next reviewable production specification. No image or video generation has started.",
    completionMessage:
      "The next production specification is ready for review. No image or video media was generated.",
  };
}
