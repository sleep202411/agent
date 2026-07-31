import { z } from 'zod';

import { StorySourceMaterialProjectionSchema } from '../agent-domain-gateway/story-source-material-index';

export {
  AgentAttachmentRegisterRequestSchema,
  AgentAttachmentRevokeRequestSchema,
  AgentAttachmentStatusRequestSchema,
  AgentAttachmentSummarySchema,
} from '@repo/shared/agent-platform';
export type {
  AgentAttachmentRegisterRequest,
  AgentAttachmentRevokeRequest,
  AgentAttachmentStatusRequest,
  AgentAttachmentSummary,
} from '@repo/shared/agent-platform';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, 'Invalid BCP 47 locale')
  .transform((value) => Intl.getCanonicalLocales(value)[0]);

const internalActorSchema = z
  .object({
    id: identifierSchema,
    displayName: z.string().trim().min(1).max(120),
  })
  .strict();
const internalStoryScopeSchema = z
  .object({
    surface: z.literal('story-studio'),
    conversationId: z.uuid(),
    sessionName: z.string().min(1).max(128),
    kind: z.literal('story-project'),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
  })
  .strict();
const internalCrewScopeSchema = z
  .object({
    surface: z.literal('crew-management'),
    conversationId: z.uuid(),
    sessionName: z.string().min(1).max(128),
    kind: z.literal('crew'),
    crewId: identifierSchema,
  })
  .strict();

export const AgentAttachmentResolveRequestSchema = z
  .object({
    schemaVersion: z.literal('agent-attachment-resolve/v1'),
    actor: internalActorSchema,
    scope: z.discriminatedUnion('surface', [
      internalStoryScopeSchema,
      internalCrewScopeSchema,
    ]),
    locale: localeSchema,
    attachmentIds: z.array(z.uuid()).min(1).max(8),
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
    if (new Set(request.attachmentIds).size !== request.attachmentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['attachmentIds'],
        message: 'attachmentIds must be unique',
      });
    }
  });

export type AgentAttachmentResolveRequest = z.infer<
  typeof AgentAttachmentResolveRequestSchema
>;

const resolvedFileSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal('file'),
    fileName: z.string().min(1).max(255),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '::1'].includes(url.hostname))
      );
    }, 'attachment URL must use HTTPS outside local development'),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const resolvedDocumentSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal('document'),
    fileName: z.string().min(1).max(255),
    mediaType: z.enum([
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
    ]),
    projection: StorySourceMaterialProjectionSchema,
  })
  .strict();

export const AgentAttachmentResolveResponseSchema = z
  .object({
    schemaVersion: z.literal('agent-attachment-resolve-result/v1'),
    attachments: z.array(
      z.discriminatedUnion('kind', [
        resolvedFileSchema,
        resolvedDocumentSchema,
      ]),
    ),
  })
  .strict();

export type AgentAttachmentResolveResponse = z.infer<
  typeof AgentAttachmentResolveResponseSchema
>;

export function agentAttachmentUri(attachmentId: string): string {
  return `fizzdragon-media://${z.uuid().parse(attachmentId)}`;
}
