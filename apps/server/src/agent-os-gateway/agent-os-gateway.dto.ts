import { z } from 'zod';
import {
  AgentApprovalResponseTextSchema,
  AgentDisplayLocaleSchema,
} from '@repo/agent-protocol';
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

/** Product workbench mode; the project-kind pairing is validated server-side. */
export const AgentOsWorkbenchModeSchema = z.string().trim().min(1).max(64);

export const AgentOsWorkbenchContextSchema = z
  .object({
    chapterId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    /** Explicit responsive product surface; never inferred from chat text. */
    experience: z.literal('mobile_h5').optional(),
  })
  .strict()
  .refine(
    (value) =>
      Number(Boolean(value.chapterId)) + Number(Boolean(value.sectionId)) === 1,
    {
      message: 'Workbench context must select exactly one scoped entity.',
    },
  );

export const AgentOsStartRunBodySchema = z
  .object({
    projectId: z.string().uuid(),
    /** Stable browser-owned conversation checkpoint identity. */
    conversationId: z.string().uuid(),
    /** Stable semantic submission identity reused across transport retries. */
    clientSubmissionId: z.string().uuid(),
    /** Stable ids for the first durable user turn and its transcript message. */
    turnId: z.string().uuid(),
    messageId: z.string().uuid(),
    message: z.string().trim().max(20_000),
    /** Required — never defaulted server-side (fail loud on missing profile). */
    modelProfileId: modelProfileIdSchema,
    /**
     * Uploaded Agent OS attachments (file upload API) referenced by this turn.
     * Prefer this over free-text paste — product path is file upload.
     */
    attachmentIds: z.array(z.string().uuid()).max(20).optional(),
    /** Permission / autonomy mode (Codex-style). Defaults to smart if omitted. */
    permissionMode: AgentOsPermissionModeSchema.optional(),
    /** Product workbench mode. Required and never inferred from chat text. */
    workbenchMode: AgentOsWorkbenchModeSchema,
    /** Selected entity inside the workbench. Story mode requires a chapter. */
    workbenchContext: AgentOsWorkbenchContextSchema.optional(),
    /**
     * Per-turn skill ids from the composer (future UI). Mounted when registered
     * in the skill runtime — same path as system skills.
     */
    skillIds: z.array(z.string().trim().min(1).max(128)).max(16).optional(),
    /**
     * Installed project Skills selected for this turn. Project defaults are
     * resolved from the database and cannot be supplied by the client.
     */
    projectSkillInstallationIds: z.array(z.string().uuid()).max(32).optional(),
    /** Project defaults disabled for this turn only. */
    disabledDefaultSkillInstallationIds: z
      .array(z.string().uuid())
      .max(32)
      .optional(),
  })
  .strict()
  .refine(
    (body) => body.message.length > 0 || Boolean(body.attachmentIds?.length),
    {
      message: 'A run requires message text or at least one attachment.',
      path: ['message'],
    },
  );

export type AgentOsStartRunBody = z.infer<typeof AgentOsStartRunBodySchema>;

const generationModelIdSchema = z.string().trim().min(1).max(180);

/**
 * One complete replacement of the actor's project-scoped model defaults.
 * Null means "automatic"; clients never invent a concrete fallback id.
 */
export const AgentOsModelPreferencesBodySchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    chatModelProfileId: modelProfileIdSchema.nullable(),
    imageModelId: generationModelIdSchema.nullable(),
    videoModelId: generationModelIdSchema.nullable(),
  })
  .strict();

export type AgentOsModelPreferencesBody = z.infer<
  typeof AgentOsModelPreferencesBodySchema
>;

// Named interfaces keep declaration emit anchored to public workspace exports
// instead of expanding a shared schema into its nested Zod installation.
type ApprovalResponseTextSchema = typeof AgentApprovalResponseTextSchema;
type DisplayLocaleSchema = typeof AgentDisplayLocaleSchema;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- A named interface prevents TS2742 during declaration emit; a type alias does not.
interface PortableApprovalResponseTextSchema extends ApprovalResponseTextSchema {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- A named interface prevents TS2742 during declaration emit; a type alias does not.
interface PortableDisplayLocaleSchema extends DisplayLocaleSchema {}
const approvalResponseTextSchema: PortableApprovalResponseTextSchema =
  AgentApprovalResponseTextSchema;
const displayLocaleSchema: PortableDisplayLocaleSchema =
  AgentDisplayLocaleSchema;

export const AgentOsApprovalBodySchema = z
  .object({
    /** Durable pending approval being answered. */
    approvalId: z.string().uuid(),
    /** Stable identity reused for retries of this semantic decision. */
    responseId: z.string().uuid(),
    decision: z.enum(['approve', 'reject']),
    /** Display copy only; structured decision is the authorization authority. */
    responseText: approvalResponseTextSchema,
    /** Selects server-owned durable Assistant acknowledgement copy. */
    locale: displayLocaleSchema,
    conversationId: z.string().uuid(),
    projectId: z.string().uuid(),
    /** Required — must match the profile used for the run resume. */
    modelProfileId: modelProfileIdSchema,
    permissionMode: AgentOsPermissionModeSchema.optional(),
    /** Current decision surface; used by the Story H5 approval coordinator. */
    experience: z.literal('mobile_h5').optional(),
  })
  .strict();

export type AgentOsApprovalBody = z.infer<typeof AgentOsApprovalBodySchema>;

export const AgentOsUserInputBodySchema = z
  .object({
    requestId: z.string().uuid(),
    /** Stable for retries of one submitted answer; never regenerated by transport retry. */
    responseId: z.string().uuid(),
    answers: z.record(
      z.string().trim().min(1).max(64),
      z.string().trim().min(1).max(64),
    ),
    conversationId: z.string().uuid(),
    projectId: z.string().uuid(),
    modelProfileId: modelProfileIdSchema,
    permissionMode: AgentOsPermissionModeSchema.optional(),
  })
  .strict();

export type AgentOsUserInputBody = z.infer<typeof AgentOsUserInputBodySchema>;
