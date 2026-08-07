import { tool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { requiresApproval, type AgentMode, type PermissionMode } from "@repo/agent-policy";
import {
  buildToolIdempotencyKey,
  getTool,
  parseToolInput,
  type DomainPort,
} from "@repo/agent-tools";
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
 * Bind registry tools into LangChain StructuredTools.
 * Sensitive commands use LangGraph `interrupt()` for product approval (HITL).
 */
export function buildLangChainTools(runtime: ToolRuntimeContext) {
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

  return [storeScript, readSection, listCharacters, upsertCharacters, canvasRead];
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
  const gate = requiresApproval({
    mode: runtime.mode,
    permissionMode: runtime.permissionMode,
    risk: definition.risk,
  });

  if (gate.required) {
    if (runtime.mode === "DISCUSS" && definition.risk !== "read") {
      return JSON.stringify({
        ok: false,
        code: "DISCUSS_WRITE_FORBIDDEN",
        message: gate.reason,
      });
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
      return JSON.stringify({
        ok: false,
        code: "APPROVAL_REJECTED",
        message: "User rejected the tool call.",
      });
    }
  }

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

  return JSON.stringify(result);
}
