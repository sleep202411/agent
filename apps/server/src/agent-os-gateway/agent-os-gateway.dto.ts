import { z } from 'zod';
import {
  MODEL_PROFILE_ID_MAX_LENGTH,
  MODEL_PROFILE_ID_PATTERN,
} from '@repo/shared';

// Shape only. Whether the id exists is the worker's call — it owns the profile
// list and names the alternatives on a miss. This guard must never be narrower
// than that list, which is why the pattern is imported rather than retyped.
const modelProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MODEL_PROFILE_ID_MAX_LENGTH)
  .regex(MODEL_PROFILE_ID_PATTERN);

/** Codex-style autonomy: ask = approve every write; smart = sensitive only; full = auto. */
export const AgentOsPermissionModeSchema = z.enum(['ask', 'smart', 'full']);

/** Studio surface pack — trusted mode, not inferred from chat text. */
export const AgentOsSurfaceSchema = z.enum(['storyboard', 'canvas', 'brief']);

export const AgentOsStartRunBodySchema = z
  .object({
    projectId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(100_000),
    /** Required — never defaulted server-side (fail loud on missing profile). */
    modelProfileId: modelProfileIdSchema,
    /**
     * Uploaded Agent OS attachments (file upload API) referenced by this turn.
     * Prefer this over free-text paste — product path is file upload.
     */
    attachmentIds: z.array(z.string().uuid()).max(20).optional(),
    /** Permission / autonomy mode (Codex-style). Defaults to smart if omitted. */
    permissionMode: AgentOsPermissionModeSchema.optional(),
    /**
     * Product surface (Studio mode). Mounts system surface skills on the worker.
     */
    surface: AgentOsSurfaceSchema.optional(),
    /**
     * Per-turn skill ids from the composer (future UI). Mounted when registered
     * in the skill runtime — same path as system skills.
     */
    skillIds: z.array(z.string().trim().min(1).max(128)).max(16).optional(),
    /**
     * Project default skill ids (admin). Mounted when registered.
     */
  })
  .strict();

export type AgentOsStartRunBody = z.infer<typeof AgentOsStartRunBodySchema>;

export const AgentOsApprovalBodySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    conversationId: z.string().uuid(),
    projectId: z.string().uuid(),
    /** Required — must match the profile used for the run resume. */
    modelProfileId: modelProfileIdSchema,
    permissionMode: AgentOsPermissionModeSchema.optional(),
  })
  .strict();

export type AgentOsApprovalBody = z.infer<typeof AgentOsApprovalBodySchema>;
