/**
 * Zod schemas for the conversations REST surface.
 *
 * Wire shapes track @repo/shared/conversation; client-side hooks
 * generate request bodies that conform to these.
 */
import { z } from 'zod';
import {
  CONVERSATION_CONTEXT_TYPES,
  PROPOSAL_STATUSES,
} from '@repo/shared/conversation';
import { ALL_CURRENCIES } from '../common/currency';
import {
  SERVICE_TIERS,
  UNLIMITED_REVISIONS,
} from '@repo/shared/creator-service';

/**
 * "Find or create" a conversation for a context. Used when the
 * buyer clicks "联系创作者" on a service detail page — server
 * resolves the (buyer, creator, service) triple to an existing
 * inquiry conversation if any, otherwise creates one.
 *
 * For `service` context, the controller resolves participants from
 * the service row (buyer = caller, creator = service.creatorId).
 * For `order` context, we never call this endpoint — order creation
 * spawns its own conversation.
 */
export const OpenConversationSchema = z.object({
  contextType: z.enum(['service'] as const), // order is server-owned
  contextId: z.string().trim().min(1).max(64),
  /// Optional first message to send atomically. Common path: buyer
  /// types a question, hits Send → API creates conversation +
  /// posts the first message in one round-trip.
  firstMessage: z.string().trim().min(1).max(4000).optional(),
});
export type OpenConversationInput = z.infer<typeof OpenConversationSchema>;

const MentionSchema = z.object({
  userId: z.string().trim().min(1).max(64),
  /** Display-name snapshot without the leading @ character. */
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((label) => !/[@\r\n]/.test(label), {
      message: 'Mention label cannot contain @ or a line break',
    }),
});

const TaskReferenceSchema = z.object({
  taskId: z.string().uuid(),
  /** Exact body snapshot without the leading # character. */
  label: z
    .string()
    .trim()
    .min(1)
    .max(260)
    .refine((label) => !/[#\r\n]/.test(label), {
      message: 'Task reference label cannot contain # or a line break',
    }),
});
export type TaskReferenceInput = z.infer<typeof TaskReferenceSchema>;

/** Plain text message. Structured crew messages use the schemas below. */
export const SendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(MentionSchema).max(20).default([]),
  tasks: z.array(TaskReferenceSchema).max(20).default([]),
  /// Client-generated idempotency token for this send. Optional, but
  /// strongly recommended from anything with a retry: a flaky network
  /// that re-POSTs the same composed message otherwise appends a
  /// second copy that every member of a group chat then sees. The
  /// server collapses a retry onto the row the first attempt created
  /// and returns it unchanged.
  ///
  /// Scope is (conversation, author, key) — reusing a key across
  /// conversations is fine. Reusing it for a genuinely different
  /// message in the same conversation is a 409 conflict — generate
  /// one per composed message (a UUID is ideal).
  clientKey: z.string().trim().min(1).max(64).optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

const StructuredMessageBaseSchema = z.object({
  body: z.string().trim().max(4000).default(''),
  mentions: z.array(MentionSchema).max(20).default([]),
  tasks: z.array(TaskReferenceSchema).max(20).default([]),
  clientKey: z.string().trim().min(1).max(64).optional(),
});

/**
 * Existing crew assets remain references. Fresh chat uploads carry only the
 * confirmed MediaAsset id and display name: the service creates their
 * CrewAssetNode in the SAME transaction as the message, so cancelling or a
 * failed send can never leave a visible file in the asset center.
 *
 * Clients never submit storage URLs or object keys.
 */
const AttachmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((name) => name !== '.' && name !== '..', {
    message: 'Attachment name cannot be "." or ".."',
  })
  .refine((name) => !name.includes('/'), {
    message: 'Attachment name cannot contain "/"',
  });

const SendAttachmentItemSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('asset'),
    assetNodeId: z.string().uuid(),
  }),
  z.object({
    source: z.literal('upload'),
    mediaAssetId: z.string().uuid(),
    name: AttachmentNameSchema,
  }),
]);

export const SendAttachmentsSchema = StructuredMessageBaseSchema.extend({
  attachments: z
    .array(SendAttachmentItemSchema)
    .min(1)
    .max(10)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        const key =
          item.source === 'asset'
            ? `asset:${item.assetNodeId}`
            : `upload:${item.mediaAssetId}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index],
            message: 'The same attachment cannot be sent twice',
          });
        }
        seen.add(key);
      });
    }),
});
export type SendAttachmentsInput = z.infer<typeof SendAttachmentsSchema>;

/**
 * Proposal payload — creator's structured offer. Mirrors
 * ProposalPayload in @repo/shared/conversation.
 */
export const SendProposalSchema = z.object({
  /// Free-form note rendered above the structured block. Optional
  /// but recommended.
  note: z.string().trim().max(2000).default(''),
  packageTier: z.enum(SERVICE_TIERS),
  /// Display unit (yuan / dollar / yen). Server converts to
  /// smallest unit when materializing as an order.
  price: z.number().min(0).max(100_000_000),
  currency: z.enum(ALL_CURRENCIES),
  deliveryDays: z.number().int().min(1).max(365),
  /// -1 = unlimited; otherwise 0..200.
  revisions: z.number().int().min(UNLIMITED_REVISIONS).max(200).default(0),
  /// Scope bullets mirroring ServicePackage.scope.
  scope: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});
export type SendProposalInput = z.infer<typeof SendProposalSchema>;

/**
 * Mark messages up to and including this id as read. Idempotent —
 * older `lastReadMessageId` values never regress.
 */
export const MarkReadSchema = z.object({
  lastReadMessageId: z.string().trim().min(1).max(64),
});
export type MarkReadInput = z.infer<typeof MarkReadSchema>;

/**
 * Inbox listing query. Cursor is the last message timestamp ISO
 * encoded; server flips to id-based cursor in case of ties.
 */
export const ListInboxQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  /// Filter by context type — useful for "orders only" inbox tab.
  contextType: z.enum(CONVERSATION_CONTEXT_TYPES).optional(),
});
export type ListInboxQuery = z.infer<typeof ListInboxQuerySchema>;

/**
 * Pagination for messages within a conversation. Cursor = message
 * id; we paginate backwards (newest first).
 */
export const ListMessagesQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

/**
 * Internal helper exported so OrdersService can validate proposal
 * status names without re-importing the union literal.
 */
export const PROPOSAL_STATUS_ENUM = z.enum(PROPOSAL_STATUSES);
