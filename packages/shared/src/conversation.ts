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
 *   - `crew`     — one crew, one group chat. Conversation identity is
 *                  the crew: lookup key `crew:<crewId>`. Participants
 *                  are the crew's active members (role `member`),
 *                  synced from `crew_members` by the crews module.
 *                  Unlike service/order this is an N-party thread, so
 *                  the inbox card projects the CREW (name / logo /
 *                  member count) instead of a single counterparty.
 *
 *   Future contexts (extensible by adding the literal here + a
 *   server-side resolver): `crew_application`, `episode`,
 *   `episode_assignment`.
 *
 * Lifecycle: a `service` conversation can be promoted to an `order`
 * conversation when a proposal is accepted — the same row is
 * reused; `contextType` flips from `service` → `order` and
 * `contextId` re-points from serviceId → orderId. The pre-order
 * message history is preserved in the same thread so both sides
 * keep their full back-and-forth.
 *
 * Realtime delivery: messages are persisted first (DB is source of truth),
 * then delivered through the authenticated per-user Ably channel and, for
 * crew chat, its Ably Chat room. Conversation inbox, crew-task, and in-app
 * notification frames share the user connection. Missed-while-offline
 * windows are recovered by REST cursor refetch on every attach boundary.
 */

import type { CurrencyCode } from "./crew.js";
import type { ServiceTier } from "./creator-service.js";
import type { NotificationDTO } from "./notifications.js";

// ─── Enums ───────────────────────────────────────────────────

export const CONVERSATION_CONTEXT_TYPES = ["service", "order", "crew"] as const;
export type ConversationContextType = (typeof CONVERSATION_CONTEXT_TYPES)[number];

/**
 * Participant roles.
 *
 * `buyer` / `creator` are the two sides of a service or order thread and
 * DO carry authorization weight (only `creator` may post a proposal, only
 * `buyer` may accept or decline one).
 *
 * `member` is the single role every crew-chat participant gets. It is
 * deliberately flat — crew authority is resolved from ownership, policy
 * bundles, and permission overrides by the crew authorization boundary.
 * Mirroring authorization here would duplicate mutable state and give the
 * order state machine roles it must never see. Because `member` is
 * neither `buyer` nor `creator`, every proposal / order gate fails closed
 * for crew rows without a single extra branch.
 */
export const CONVERSATION_PARTICIPANT_ROLES = ["buyer", "creator", "member"] as const;
export type ConversationParticipantRole = (typeof CONVERSATION_PARTICIPANT_ROLES)[number];

export const CONVERSATION_MESSAGE_TYPES = ["text", "image", "file", "proposal", "system"] as const;
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
  // Crew chat — membership lifecycle. params: { userId }
  "crew.member.joined",
  "crew.member.left",
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
 * A durable reference behind an inline @mention.
 *
 * `label` is the display-name snapshot written into `body`; `userId` is
 * the stable identity used for notification routing and later profile
 * changes. The server validates every id against the crew's live roster,
 * so clients cannot smuggle an outsider into a protected thread.
 */
export interface ConversationMentionPayload {
  userId: string;
  label: string;
}

export interface ConversationAttachmentPayload {
  /** Durable crew asset reference. Never a raw storage key or signed URL. */
  assetNodeId: string;
  mediaAssetId: string;
  name: string;
  mediaKind: "image" | "video" | "audio" | "document" | "other";
  contentType: string;
  sizeBytes: number | null;
}

/**
 * Durable identity behind an inline #task reference.
 *
 * `label` is the exact snapshot embedded in the message body without the
 * leading `#`. The remaining fields let clients open the referenced task and
 * render useful context without trusting human-readable text as identity.
 */
export interface ConversationTaskReferencePayload {
  taskId: string;
  crewId: string;
  number: number;
  label: string;
}

/**
 * Union of payload shapes carried by a Message. The runtime
 * `type` field tells you which one to read.
 */
export type MessagePayload =
  | {
      kind: "text";
      mentions?: ConversationMentionPayload[];
      tasks?: ConversationTaskReferencePayload[];
    }
  | {
      kind: "attachments";
      attachments: ConversationAttachmentPayload[];
      mentions?: ConversationMentionPayload[];
      tasks?: ConversationTaskReferencePayload[];
    }
  | { kind: "proposal"; proposal: ProposalPayload }
  | { kind: "system"; system: SystemMessagePayload };

// ─── DTOs ────────────────────────────────────────────────────

export interface MessageDTO {
  id: string;
  conversationId: string;
  /** NULL for system messages — server-authored, no user. */
  authorId: string | null;
  /**
   * Caller-supplied idempotency key. The sender uses it to replace an
   * optimistic row with the persisted message even when realtime delivery
   * arrives before the HTTP response. Optional for older producers.
   */
  clientKey?: string | null;
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
 *
 * Two shapes share one row type:
 *   - `service` / `order` — two-party. The row is identified by the
 *     counterparty (avatar + nickname resolved from `counterpartyId`).
 *   - `crew` — N-party. The row is identified by the CREW, so the
 *     `crew*` fields below are populated and the renderer should use
 *     them instead of resolving `counterpartyId` as a user.
 *
 * `counterpartyId` / `counterpartyRole` stay REQUIRED and non-nullable
 * for both shapes — the shipped order inbox dereferences them
 * unconditionally, and widening them to optional would be a breaking
 * type change for a surface crew chat has no business touching. For a
 * crew row they carry the crew's own identity (`counterpartyId` ===
 * `contextId` === `crewId`, role `member`), which is stable, never the
 * viewer themselves, and never a random other member.
 */
export interface ConversationCardDTO {
  id: string;
  contextType: ConversationContextType;
  contextId: string;
  /** The other participant from the viewer's perspective. For a `crew`
   *  row there is no single other party — this is the crew id. */
  counterpartyId: string;
  counterpartyRole: ConversationParticipantRole;
  /** Short summary line — server-rendered (text body / "[proposal]" /
   *  i18n key for system messages — client resolves system) for
   *  inbox row display. */
  lastMessagePreview: string;
  lastMessageType: ConversationMessageType;
  lastMessageAt: string;
  unreadCount: number;

  // ─── crew rows only (undefined for service / order) ───────

  /** Crew this thread belongs to. Mirrors `contextId`. */
  crewId?: string;
  crewName?: string;
  /** Crew logo URL — required on the Crew row, so always set when
   *  `crewName` is. */
  crewLogo?: string;
  /** Active member count — the group-chat equivalent of an avatar. */
  memberCount?: number;
}

// ─── Realtime frame envelopes ────────────────────────────────

/**
 * Frames delivered through the authenticated per-user Ably channel.
 * The payload stays transport-neutral: `{ event, data }`.
 *
 * Add a new frame variant: extend the union here AND in
 * `apps/web/src/lib/conversations/ably-client.ts`.
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
  | {
      event: "crew.task.changed";
      data: {
        crewId: string;
        taskId: string;
        action: "created" | "updated" | "commented" | "submitted" | "reviewed" | "settled";
        actorUserId: string | null;
      };
    }
  | {
      event: "crew.task.project.changed";
      data: {
        crewId: string;
        resource:
          | "view"
          | "workflow"
          | "cycle"
          | "label"
          | "field"
          | "production_document"
          | "production_project"
          | "production_resource"
          | "production_activity"
          | "episode"
          | "delivery";
        resourceId: string;
        action: "created" | "updated" | "deleted" | "reordered";
        actorUserId: string | null;
      };
    }
  | {
      event: "crew.asset.changed";
      data: {
        crewId: string;
        nodeId: string;
        action: "created" | "updated" | "trashed" | "restored" | "deleted" | "permissions_updated";
        actorUserId: string | null;
      };
    }
  | {
      /**
       * Notifications share the authenticated per-user Ably channel with
       * conversation inbox and crew-task invalidations. PostgreSQL remains
       * authoritative; this frame is only the low-latency signal.
       */
      event: "notification.created";
      data: NotificationDTO;
    }
  /** Synthetic client boundary emitted after the Ably user channel has
   *  attached. A client REST-refetches here to close startup/reconnect gaps. */
  | { event: "ready"; data: { serverTime: number } }
  | { event: "terminate"; data: { reason: string; code: number } };

// ─── Ably channel + credential contracts ─────────────────────

/** Per-user Ably Pub/Sub channel for inbox and domain invalidation frames. */
export function conversationChannel(userId: string): string {
  return `conversation:user:${userId}`;
}

export const CONVERSATION_CHANNEL_PATTERN = "conversation:user:*";
export const CONVERSATION_CHANNEL_PREFIX = "conversation:user:";
export const CONVERSATION_REALTIME_EVENT = "frame";

/** One crew conversation maps to one Ably Chat room. */
export function crewConversationRoom(conversationId: string): string {
  return `crew-chat:${conversationId}`;
}

export const CREW_CONVERSATION_METADATA_SCHEMA = "fizzdragon.crew-chat.signal.v1";

/**
 * The seven public fields of an Ably TokenRequest. The root key is never
 * serialized into this contract.
 */
export interface ConversationAblyTokenRequestDTO {
  keyName: string;
  ttl?: number;
  timestamp: number;
  capability: string;
  clientId?: string;
  nonce: string;
  mac: string;
}

export interface ConversationRealtimeGrantDTO {
  channel: string;
  ttlMs: number;
  tokenRequest: ConversationAblyTokenRequestDTO;
}

export interface CrewConversationRealtimeGrantDTO extends ConversationRealtimeGrantDTO {
  room: string;
}

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
