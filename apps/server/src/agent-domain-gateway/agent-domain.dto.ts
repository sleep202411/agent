import { z } from 'zod';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const storyScopeSchema = z
  .object({
    surface: z.literal('story-studio'),
    conversationId: z.uuid(),
    sessionName: z.string().min(1).max(128),
    kind: z.literal('story-project'),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
  })
  .strict();
const crewScopeSchema = z
  .object({
    surface: z.literal('crew-management'),
    conversationId: z.uuid(),
    sessionName: z.string().min(1).max(128),
    kind: z.literal('crew'),
    crewId: identifierSchema,
  })
  .strict();

export const AgentDomainToolRequestSchema = z
  .object({
    schemaVersion: z.literal('agent-tool-request/v2'),
    arguments: z.unknown(),
    actor: z
      .object({
        id: identifierSchema,
        displayName: z.string().trim().min(1).max(120),
        roles: z.array(identifierSchema).max(64),
        permissions: z.array(identifierSchema).max(256),
      })
      .strict(),
    scope: z.discriminatedUnion('surface', [storyScopeSchema, crewScopeSchema]),
  })
  .strict()
  .superRefine((request, context) => {
    const expected = `agent:v1:conversation:${request.scope.conversationId}`;
    if (request.scope.sessionName !== expected) {
      context.addIssue({
        code: 'custom',
        path: ['scope', 'sessionName'],
        message: 'sessionName does not match the conversation identity',
      });
    }
  });

export type AgentDomainToolRequest = z.infer<
  typeof AgentDomainToolRequestSchema
>;

export const AgentDomainToolIdSchema = z.enum([
  'story_get_source_analysis',
  'story_query_source_material',
  'story_get_snapshot',
  'story_apply_change_set',
  'crew_get_state',
  'crew_apply_management_command',
  'crew_apply_finance_command',
  'crew_submit_own_assignment',
]);

export type AgentDomainToolId = z.infer<typeof AgentDomainToolIdSchema>;

export const AgentDomainToolResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('succeeded'),
      data: z.unknown(),
      revision: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('rejected'),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          retryable: z.literal(false),
          details: z.unknown().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type AgentDomainToolResult = z.infer<typeof AgentDomainToolResultSchema>;
