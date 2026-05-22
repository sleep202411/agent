/**
 * Conversations — context-scoped messaging.
 *
 * Every conversation is rooted in a domain entity, NOT free-form DM.
 * The supported contexts today:
 *
 *   - `service`  — a buyer is inquiring about a CreatorService.
 *                  Conversation identity is (buyer, creator, service);
 *                  the same triple resumes the same thread.
 *
 *   - `order`    — a buyer + creator are executing a ServiceOrder.
 *                  Always exactly one conversation per order.
 *
 *   Future contexts (extensible by adding the literal here + a
 *   server-side resolver): `crew`, `crew_application`, `episode`,
 *   `episode_assignment`.
 *
 * Lifecycle: a `service` conversation can be promoted to an `order`
 * conversation when a proposal is accepted — the same row is
 * reused; `contextType` flips from `service` → `order` and
 * `contextId` re-points from serviceId → orderId. The pre-order
 * message history is preserved in the same thread so both sides
 * keep their full back-and-forth.
 *
 * Realtime delivery: messages are persisted first (DB is source of
 * truth), then published to a per-user Redis pub/sub channel
 * (`conversation:user:{userId}`) so every browser tab the user has
 * open receives the push. Missed-while-offline windows are
 * recovered by the client refetching on reconnect (cursor-based on
 * createdAt).
 */

import type { CurrencyCode } from "./crew.js";
import type { ServiceTier } from "./creator-service.js";

// ─── Enums ───────────────────────────────────────────────────

export const CONVERSATION_CONTEXT_TYPES = ["service", "order"] as const;
export type ConversationContextType = (typeof CONVERSATION_CONTEXT_TYPES)[number];

export const CONVERSATION_PARTICIPANT_ROLES = ["buyer", "creator"] as const;
export type ConversationParticipantRole = (typeof CONVERSATION_PARTICIPANT_ROLES)[number];

export const CONVERSATION_MESSAGE_TYPES = [
  "text",
  /** Reserved for v1.1 once attachments ship. */
  "image",
  /** Reserved for v1.1 once attachments ship. */
  "file",
  "proposal",
  "system",
] as const;
// Renamed from `MessageType` to disambiguate from chat.ts (Mastra
// assistant wire shape); re-export from shared/index.ts would
// otherwise collide.
export type ConversationMessageType = (typeof CONVERSATION_MESSAGE_TYPES)[number];

export const PROPOSAL_STATUSES = ["open", "accepted", "declined", "cancelled"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/**
 * System message kinds. Server emits these on state-machine events;
 * the client renders them via an i18n template keyed on `kind` so
 * copy stays per-locale instead of being baked into the wire body.
 *
 *   `params` is a free-form bag the renderer interpolates into the
 *   localized template.
 */
export const SYSTEM_MESSAGE_KINDS = [
  // Conversation lifecycle
  "conversation.created",
  "conversation.context_changed_to_order",
  // Proposal
  "proposal.declined",
  // Order lifecycle
  "order.submitted",
  "order.accepted",
  "order.declined",
  "order.delivered",
  "order.revision_requested",
  "order.completed",
  "order.cancelled",
] as const;
export type SystemMessageKind = (typeof SYSTEM_MESSAGE_KINDS)[number];

// ─── Message payloads ────────────────────────────────────────

/**
 * A creator's structured offer. Buyer accepts → order is created in
 * `in_progress`; buyer declines → status flips to `declined`.
 *
 * The proposal stays as a regular message in the thread (so the
 * timeline reads chronologically), but its `status` evolves as the
 * other side reacts.
 */
export interface ProposalPayload {
  status: ProposalStatus;
  packageTier: ServiceTier;
  /** Display unit. */
  price: number;
  currency: CurrencyCode;
  deliveryDays: number;
  /** -1 = unlimited. */
  revisions: number;
  /** Bullet list mirroring ServicePackage.scope. */
  scope: string[];
  /** Free-form note from the creator above the structured block. */
  note: string;
  /** Set when status moves out of `open`. */
  acceptedAt?: string | null;
  declinedAt?: string | null;
  /** Order created from this proposal (only set after accept). */
  orderId?: string | null;
}

export interface SystemMessagePayload {
  kind: SystemMessageKind;
  /** Variables for the i18n renderer (e.g. order id, package title). */
  params: Record<string, string | number>;
}

/**
 * Union of payload shapes carried by a Message. The runtime
 * `type` field tells you which one to read.
 */
export type MessagePayload =
  | { kind: "text" }
  | { kind: "proposal"; proposal: ProposalPayload }
  | { kind: "system"; system: SystemMessagePayload };

// ─── DTOs ────────────────────────────────────────────────────

export interface MessageDTO {
  id: string;
  conversationId: string;
  /** NULL for system messages — server-authored, no user. */
  authorId: string | null;
  type: ConversationMessageType;
  /** Plain text body. For type=text, the entire message; for
   *  type=proposal, the leading note (rendered above the price
   *  block); for type=system, empty (use `payload.system.kind`). */
  body: string;
  /** Structured payload — null for plain text. */
  payload: MessagePayload | null;
  createdAt: string;
}

export interface ConversationParticipantDTO {
  userId: string;
  role: ConversationParticipantRole;
  /** Cursor for unread-badge math: messages with id > this are unread. */
  lastReadMessageId: string | null;
}

export interface ConversationDTO {
  id: string;
  contextType: ConversationContextType;
  contextId: string;
  participants: ConversationParticipantDTO[];

  /** Most recent message preview, for the inbox row. NULL only on
   *  freshly-created empty conversations (rare — first message is
   *  usually sent in the same request). */
  lastMessage: MessageDTO | null;
  lastMessageAt: string;

  /** Convenience field — server computes per-viewer unread count
   *  using the viewer's `lastReadMessageId`. */
  unreadCount: number;

  createdAt: string;
}

/**
 * Inbox row projection. Drops participants[] (rendered via the
 * creator/buyer profile cache instead) and shortens lastMessage to
 * a preview string + author.
 */
export interface ConversationCardDTO {
  id: string;
  contextType: ConversationContextType;
  contextId: string;
  /** The other participant from the viewer's perspective. */
  counterpartyId: string;
  counterpartyRole: ConversationParticipantRole;
  /** Short summary line — server-rendered (text body / "[proposal]" /
   *  i18n key for system messages — client resolves system) for
   *  inbox row display. */
  lastMessagePreview: string;
  lastMessageType: ConversationMessageType;
  lastMessageAt: string;
  unreadCount: number;
}

// ─── WS frame envelopes ──────────────────────────────────────

/**
 * WS frames the conversations gateway pushes. Same envelope shape
 * as the existing notification gateway: `{ event, data }`.
 *
 * Add a new frame variant: extend the union here AND in
 * `apps/web/src/lib/conversations/ws-client.ts`.
 */
export type ConversationFrame =
  | {
      event: "message.created";
      data: {
        conversationId: string;
        message: MessageDTO;
        /** Server pre-computes the post-send lastMessageAt + the
         *  recipient's unread count so the client can update the
         *  inbox row without an extra round-trip. */
        lastMessageAt: string;
        unreadCount: number;
      };
    }
  | {
      event: "read.advanced";
      data: {
        conversationId: string;
        userId: string;
        lastReadMessageId: string;
      };
    }
  | {
      event: "context.changed";
      data: {
        conversationId: string;
        from: ConversationContextType;
        to: ConversationContextType;
        contextId: string;
      };
    }
  | { event: "heartbeat"; data: { serverTime: number } }
  | { event: "terminate"; data: { reason: string; code: number } };

// ─── Pub/sub channel helpers ─────────────────────────────────

/** Per-user Redis pub/sub channel. Mirror of `notificationChannel`. */
export function conversationChannel(userId: string): string {
  return `conversation:user:${userId}`;
}

export const CONVERSATION_CHANNEL_PATTERN = "conversation:user:*";
export const CONVERSATION_CHANNEL_PREFIX = "conversation:user:";

// ─── Helpers ─────────────────────────────────────────────────

const TERMINAL_PROPOSAL: Set<ProposalStatus> = new Set(["accepted", "declined", "cancelled"]);

export function isProposalTerminal(s: ProposalStatus): boolean {
  return TERMINAL_PROPOSAL.has(s);
}

export function isSystemMessage(m: MessageDTO): boolean {
  return m.type === "system";
}

export function isProposalMessage(m: MessageDTO): boolean {
  return m.type === "proposal";
}
