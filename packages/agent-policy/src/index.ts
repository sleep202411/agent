import { z } from "zod";

/**
 * Product agent operating modes (production guide §7.1).
 */
export const AgentModeSchema = z.enum(["DISCUSS", "ASSIST", "AUTOPILOT"]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

/**
 * Operation risk (production guide §7.2).
 */
export const RiskLevelSchema = z.enum(["read", "reversible", "sensitive", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * Creator-facing permission preference for how aggressively to auto-execute.
 * Maps onto approval strictness without replacing AgentMode.
 */
export const PermissionModeSchema = z.enum(["ask", "smart", "full"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export type ApprovalRequirement =
  | { required: false }
  | {
      required: true;
      actions: ReadonlyArray<"approve" | "edit_and_approve" | "reject">;
      reason: string;
    };

/**
 * Decide whether a tool call must pause for human approval.
 *
 * DISCUSS: no real side effects — treat any non-read as forbidden at the policy
 * boundary (callers must not schedule those tools).
 */
export function requiresApproval(input: {
  mode: AgentMode;
  permissionMode: PermissionMode;
  risk: RiskLevel;
}): ApprovalRequirement {
  const { mode, permissionMode, risk } = input;

  if (mode === "DISCUSS") {
    if (risk === "read") return { required: false };
    return {
      required: true,
      actions: ["reject"],
      reason: "DISCUSS mode only allows read/analyze operations.",
    };
  }

  if (risk === "read") return { required: false };

  if (risk === "critical") {
    return {
      required: true,
      actions: ["approve", "edit_and_approve", "reject"],
      reason: "Critical operations always require explicit approval.",
    };
  }

  if (permissionMode === "ask") {
    if (risk === "reversible" || risk === "sensitive") {
      return {
        required: true,
        actions: ["approve", "edit_and_approve", "reject"],
        reason: "Permission mode is ask — every write requires approval.",
      };
    }
  }

  if (permissionMode === "smart") {
    if (risk === "sensitive") {
      return {
        required: true,
        actions: ["approve", "edit_and_approve", "reject"],
        reason: "Sensitive operations require approval in smart mode.",
      };
    }
    // read + reversible auto-run
    return { required: false };
  }

  // permissionMode === "full" (Codex "full access"):
  // Auto-run reversible + sensitive. Critical already forced above.
  return { required: false };
}

/**
 * @deprecated Prefer `@repo/agent-tools` riskForTool — kept for transitional tests.
 */
export const CANVAS_TOOL_RISK = {
  "canvas.read": "read",
  "canvas.readSelected": "read",
  "canvas.analyze": "read",
  "canvas.previewPatch": "read",
  "canvas.applyPatch": "sensitive",
  "script.readSection": "read",
  "characters.list": "read",
  "characters.upsert": "sensitive",
} as const satisfies Record<string, RiskLevel>;

export function riskForCanvasTool(toolId: string): RiskLevel {
  if (toolId in CANVAS_TOOL_RISK) {
    return CANVAS_TOOL_RISK[toolId as keyof typeof CANVAS_TOOL_RISK];
  }
  return "critical";
}
