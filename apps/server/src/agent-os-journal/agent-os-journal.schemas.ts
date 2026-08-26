import {
  AgentExternalJobHandoffSchema,
  StoryProductionContinuationPlanSchema,
} from '@repo/agent-tools';
import { ProjectSkillResolutionSnapshotSchema } from '@repo/agent-skills';
import { z } from 'zod';

// Re-declare the wire shape at the Nest boundary: agent-protocol and this app
// intentionally run distinct physical Zod builds, whose schema instances are
// not structurally assignable even though their parsed values are identical.
const AgentUserMessageAttachmentSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string().trim().min(1).max(500),
  })
  .strict();

/** Durable projection required to resume or complete an external tool job. */
export const AgentOsPendingExternalSchema =
  AgentExternalJobHandoffSchema.extend({
    turnId: z.string().uuid(),
    toolCallId: z.string().trim().min(1).max(256),
    toolId: z.string().trim().min(1).max(128),
  }).strict();

export type AgentOsPendingExternal = z.infer<
  typeof AgentOsPendingExternalSchema
>;

/** Durable command dispatched from Nest to the Agent worker after admission. */
export const AgentOsStartCommandSchema = z
  .object({
    runId: z.string().uuid(),
    clientSubmissionId: z.string().uuid(),
    /** Gateway hash of normalized public request semantics. */
    submissionFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    turnId: z.string().uuid(),
    messageId: z.string().uuid(),
    projectId: z.string().uuid(),
    conversationId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(128),
    message: z.string().max(20_000),
    modelContext: z.string().max(20_000).optional(),
    modelProfileId: z.string().trim().min(1).max(64),
    /** Ordered public references used for replay and Worker attachment context. */
    attachmentIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    attachments: z
      .array(AgentUserMessageAttachmentSchema)
      .min(1)
      .max(20)
      .optional(),
    permissionMode: z.enum(['ask', 'smart', 'full']).optional(),
    projectKind: z.enum(['platform', 'story']),
    workbenchMode: z.string().trim().min(1).max(64),
    workbenchContext: z.record(z.string(), z.string()).optional(),
    skillIds: z.array(z.string().trim().min(1).max(128)).max(32).optional(),
    projectSkillInstallationIds: z.array(z.string().uuid()).max(32).optional(),
    disabledDefaultSkillInstallationIds: z
      .array(z.string().uuid())
      .max(32)
      .optional(),
    skillMountSnapshot: ProjectSkillResolutionSnapshotSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (command.message.trim().length === 0 && !command.attachments?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A start command requires message text or at least one attachment.',
        path: ['message'],
      });
    }
    if (
      Boolean(command.attachmentIds?.length) !==
      Boolean(command.attachments?.length)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Attachment ids and durable display summaries must be supplied together.',
        path: ['attachmentIds'],
      });
      return;
    }
    if (command.attachmentIds && command.attachments) {
      const attachmentIds = command.attachmentIds;
      const attachments = command.attachments;
      if (new Set(attachmentIds).size !== attachmentIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Attachment ids must be unique and ordered.',
          path: ['attachmentIds'],
        });
      }
      if (
        attachmentIds.length !== attachments.length ||
        attachmentIds.some(
          (attachmentId, index) => attachmentId !== attachments[index]?.id,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Attachment summaries must preserve the ordered attachment ids.',
          path: ['attachments'],
        });
      }
    }
  });

export type AgentOsStartCommand = z.infer<typeof AgentOsStartCommandSchema>;

const AgentOsContinuationCommandBaseSchema = z.object({
  runId: z.string().uuid(),
  turnId: z.string().uuid(),
  responseId: z.string().uuid(),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  actorId: z.string().trim().min(1).max(128),
  modelProfileId: z.string().trim().min(1).max(64),
  projectKind: z.enum(['platform', 'story']),
  workbenchMode: z.string().trim().min(1).max(64),
  workbenchContext: z.record(z.string(), z.string()).optional(),
  permissionMode: z.enum(['ask', 'smart', 'full']).default('smart'),
  skillMountSnapshot: ProjectSkillResolutionSnapshotSchema,
});

/**
 * One checkpoint-resume command admitted by an append-only HITL resolution or
 * an authoritative external-job result. It is deliberately distinct from
 * initial start: both use leased dispatch, but only a continuation may resume
 * an existing interrupt checkpoint.
 */
export const AgentOsContinuationCommandSchema = z.discriminatedUnion('kind', [
  AgentOsContinuationCommandBaseSchema.extend({
    kind: z.literal('approval'),
    approvalId: z.string().uuid(),
    decision: z.enum(['approve', 'reject']),
  }).strict(),
  AgentOsContinuationCommandBaseSchema.extend({
    kind: z.literal('user_input'),
    requestId: z.string().uuid(),
    answers: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  }).strict(),
  AgentOsContinuationCommandBaseSchema.extend({
    kind: z.literal('external_result'),
    externalJobId: z.string().uuid(),
    toolCallId: z.string().trim().min(1).max(256),
    toolId: z.string().trim().min(1).max(128),
    resultMessageId: z.string().trim().min(1).max(256),
    phase: z.literal('apply'),
    outcome: z.literal('completed'),
    storyContinuation: z
      .object({
        locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
        plan: StoryProductionContinuationPlanSchema,
      })
      .strict()
      .optional(),
  }).strict(),
]);

export type AgentOsContinuationCommand = z.infer<
  typeof AgentOsContinuationCommandSchema
>;
