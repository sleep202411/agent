import { z } from "zod";

import { AgentOsIdSchema, AgentOsIsoTimestampSchema, AgentOsNonEmptyIdSchema } from "./ids.js";
import { AgentWorkspaceRefSchema } from "./workspace.js";

export const AgentRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_for_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentAttachmentRefSchema = z
  .object({
    attachmentId: AgentOsIdSchema,
    kind: z.enum(["image", "video", "audio", "document", "other"]),
    name: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
export type AgentAttachmentRef = z.infer<typeof AgentAttachmentRefSchema>;

export const AgentRunMessageSchema = z
  .object({
    id: AgentOsNonEmptyIdSchema,
    text: z.string().min(1).max(100_000),
    attachments: z.array(AgentAttachmentRefSchema).max(32).optional(),
  })
  .strict();
export type AgentRunMessage = z.infer<typeof AgentRunMessageSchema>;

export const AgentModelPreferenceSchema = z
  .object({
    profileId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_-]*$/),
  })
  .strict();
export type AgentModelPreference = z.infer<typeof AgentModelPreferenceSchema>;

/**
 * POST /v1/agent-os/runs — start an interactive Agent OS run.
 */
export const AgentRunRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-os-run-request/v1"),
    projectId: AgentOsIdSchema,
    conversationId: AgentOsIdSchema,
    workspace: AgentWorkspaceRefSchema,
    message: AgentRunMessageSchema,
    model: AgentModelPreferenceSchema,
    clientStateVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentRunAcceptedSchema = z
  .object({
    schemaVersion: z.literal("agent-os-run-accepted/v1"),
    runId: AgentOsIdSchema,
    conversationId: AgentOsIdSchema,
    status: z.literal("queued"),
    createdAt: AgentOsIsoTimestampSchema,
  })
  .strict();
export type AgentRunAccepted = z.infer<typeof AgentRunAcceptedSchema>;

export const AgentApprovalDecisionSchema = z.enum(["approve", "edit_and_approve", "reject"]);
export type AgentApprovalDecision = z.infer<typeof AgentApprovalDecisionSchema>;

export const AgentApprovalResponseSchema = z
  .object({
    schemaVersion: z.literal("agent-os-approval-response/v1"),
    decision: AgentApprovalDecisionSchema,
    patch: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type AgentApprovalResponse = z.infer<typeof AgentApprovalResponseSchema>;

export const AgentCancelRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-os-cancel-request/v1"),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export type AgentCancelRequest = z.infer<typeof AgentCancelRequestSchema>;

export const AgentSteerRequestSchema = z
  .object({
    schemaVersion: z.literal("agent-os-steer-request/v1"),
    instruction: z.string().trim().min(1).max(20_000),
  })
  .strict();
export type AgentSteerRequest = z.infer<typeof AgentSteerRequestSchema>;
