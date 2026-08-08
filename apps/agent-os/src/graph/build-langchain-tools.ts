import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { requiresApproval, type AgentMode, type PermissionMode } from "@repo/agent-policy";
import {
  buildToolIdempotencyKey,
  getTool,
  parseToolInput,
  type DomainPort,
} from "@repo/agent-tools";
import type { AgentOsSurface } from "@repo/shared";
import { z } from "zod/v3";

import { toLangChainToolName } from "./tool-name.js";

export interface ToolRuntimeContext {
  runId: string;
  conversationId: string;
  projectId: string;
  actorId: string;
  mode: AgentMode;
  permissionMode: PermissionMode;
  domain: DomainPort;
  surface: AgentOsSurface;
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
        text: z.string().min(1).max(200_000),
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
  } as const;

  const allowed = new Set(toolIds);
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
    mode: runtime.mode,
    permissionMode: runtime.permissionMode,
    risk: definition.risk,
  });

  if (gate.required) {
    if (runtime.mode === "DISCUSS" && definition.risk !== "read") {
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
