import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { requiresApproval, type AgentMode, type PermissionMode } from "@repo/agent-policy";
import {
  buildToolIdempotencyKey,
  getTool,
  parseToolInput,
  type DomainPort,
} from "@repo/agent-tools";
import { STORY_PATCH_OPERATION_LABELS } from "@repo/shared/story-agent";
import { z } from "zod/v3";

import { toLangChainToolName } from "./tool-name.js";

export interface ToolRuntimeContext {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  skillResolutionId: string;
  skillVersionIds: readonly string[];
  workbenchContext?: Readonly<Record<string, string>>;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  domain: DomainPort;
  /** Journal fan-out for ToolStarted / ToolCompleted / ToolFailed. */
  onToolEvent?: (event: {
    type: "ToolStarted" | "ToolCompleted" | "ToolFailed";
    toolId: string;
    toolCallId: string;
    data?: Record<string, unknown>;
  }) => void;
}

export type ApprovalInterruptValue = {
  kind: "tool_approval";
  toolId: string;
  toolCallId: string;
  arguments: unknown;
  title: string;
  description: string;
};

/**
 * Bind registry tools into LangChain StructuredTools for the mounted skill set.
 * Sensitive commands use LangGraph `interrupt()` for product approval (HITL).
 * Tools not listed in the skill mount are never bound — the model cannot call them.
 */
export function buildLangChainTools(runtime: ToolRuntimeContext, toolIds: readonly string[]) {
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
  const storyScene = z.object({
    nodeId: storyStableId,
    clipKey: storyClipKey,
    name: z.string().max(120).optional(),
    description: z.string().max(4_000).optional(),
  });
  const storyInteractionAction = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("continue") }),
    z.object({ kind: z.literal("seek"), timeMs: z.number().int().min(0) }),
    z.object({ kind: z.literal("goto"), nodeId: storyStableId }),
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
    z.object({
      title: z.string().trim().min(1).max(160),
      summary: z.string().trim().min(1).max(4_000),
      brief: z.string().trim().min(1).max(8_000),
    })
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

  const byRegistryId = {
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
    "story.updateBible": storyUpdateBible,
    "story.addScene": storyAddScene,
    "story.addBranch": storyAddBranch,
    "story.editNode": storyEditNode,
    "story.putInteraction": storyPutInteraction,
    "story.removeInteraction": storyRemoveInteraction,
    "story.removeSubtree": storyRemoveSubtree,
    "story.setEntry": storySetEntry,
    "story.reorder": storyReorder,
    "story.applyPatch": storyApplyPatch,
    "story.author": storyAuthor,
  } as const;

  const allowed = new Set(toolIds);
  const unknown = [...allowed].filter((id) => !(id in byRegistryId));
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
  const parsed = parseToolInput(
    toolId,
    toolId === "script.readSection"
      ? {
          ...(raw as object),
          maxChars:
            (raw as { maxChars?: number }).maxChars === undefined
              ? 8000
              : (raw as { maxChars?: number }).maxChars,
        }
      : raw
  );

  const callId = toolCallId ?? crypto.randomUUID();
  const emit = runtime.onToolEvent;
  const gate = requiresApproval({
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
      emit?.({
        type: "ToolFailed",
        toolId,
        toolCallId: callId,
        data: { code: denied.code, message: denied.message, retryable: false },
      });
      return JSON.stringify(denied);
    }
    const decision = interrupt({
      kind: "tool_approval",
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
      emit?.({
        type: "ToolFailed",
        toolId,
        toolCallId: callId,
        data: { code: rejected.code, message: rejected.message, retryable: false },
      });
      return JSON.stringify(rejected);
    }
  }

  emit?.({
    type: "ToolStarted",
    toolId,
    toolCallId: callId,
    data: {},
  });

  try {
    const result = await runtime.domain.execute(toolId, parsed, {
      runId: runtime.runId,
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
    });

    if (result && typeof result === "object" && "ok" in result && result.ok === false) {
      const failed = result as {
        ok: false;
        code?: string;
        message?: string;
        retryable?: boolean;
      };
      emit?.({
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
      const data =
        result && typeof result === "object" && "data" in result
          ? (result as { data: unknown }).data
          : result;
      emit?.({
        type: "ToolCompleted",
        toolId,
        toolCallId: callId,
        data: {
          result:
            data && typeof data === "object" && !Array.isArray(data)
              ? (data as Record<string, unknown>)
              : { value: data },
        },
      });
    }

    return JSON.stringify(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit?.({
      type: "ToolFailed",
      toolId,
      toolCallId: callId,
      data: { code: "TOOL_EXCEPTION", message, retryable: true },
    });
    throw error;
  }
}
