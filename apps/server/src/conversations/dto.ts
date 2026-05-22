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

/**
 * Plain text body. Attachments deferred to a later phase.
 */
export const SendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

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
