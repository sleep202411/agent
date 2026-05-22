/**
 * Service order — the transaction object after a buyer commits.
 *
 * An order is created in two paths:
 *
 *   1. Questionnaire-first (cold):
 *      buyer fills the service's requirement questions → submits →
 *      order in `pending_creator` state. Creator must accept or
 *      decline.
 *
 *   2. Proposal-first (warm, after chatting):
 *      creator sends a `proposal` message in the existing
 *      conversation → buyer accepts → order created directly in
 *      `in_progress`. Conversation contextType flips service→order.
 *
 * State machine (server-enforced; client UI gates the buttons but
 * the source of truth is the service layer):
 *
 *   pending_creator ──accept──> in_progress ──deliver──> delivered
 *                                                          │  │
 *                                ┌─revision_requested──────┘  │
 *                                │                            │
 *                                └─in_progress (creator re-delivers)
 *                                                          ┌───┘
 *                                                  accept-delivery
 *                                                          │
 *                                                          ▼
 *                                                       completed
 *
 *   any-state ──cancel──> cancelled (terminal)
 *
 * Money: stored as smallest-unit on the row + currency code,
 * mirroring CrewPosition / ServicePackage conventions.
 *
 * Snapshot semantics: once an order exists, `packageSnapshot` and
 * `questionnaire` are frozen — the creator can keep editing the
 * underlying service without rewriting order history.
 */

import type { CurrencyCode } from "./crew.js";
import type { ServiceTier } from "./creator-service.js";

// ─── Enums ───────────────────────────────────────────────────

export const ORDER_STATUSES = [
  "pending_creator",
  "in_progress",
  "delivered",
  "revision_requested",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The buyer's role in the transaction. We carry both endpoints
 * (creator vs buyer) explicitly on the DTO so the client can render
 * the action set without re-querying.
 */
export type OrderParticipantRole = "buyer" | "creator";

/**
 * Reason the order was cancelled. Captures who and why so disputes
 * have a paper trail later.
 */
export interface OrderCancelInfo {
  by: OrderParticipantRole;
  reason: string;
  at: string;
}

// ─── Snapshots ───────────────────────────────────────────────

/**
 * A frozen copy of the package the buyer agreed to. The underlying
 * ServicePackage can change after this; the order keeps its own
 * copy so price / scope / delivery never silently drift mid-order.
 */
export interface OrderPackageSnapshot {
  packageId: string;
  tier: ServiceTier;
  title: string;
  description: string;
  /** Display unit (yuan / dollar / yen). */
  price: number;
  currency: CurrencyCode;
  deliveryDays: number;
  /** -1 = unlimited (mirror of ServicePackage). */
  revisions: number;
  scope: string[];
}

export interface OrderQuestionnaireEntry {
  /** Free-form prompt rendered to the buyer. */
  prompt: string;
  /** Buyer's answer (may be empty when the question is optional). */
  answer: string;
  /** Whether the prompt was marked required at order time. */
  required: boolean;
}

// ─── FD-specific bindings ────────────────────────────────────

/**
 * Optional links from an order to other FizzDragon entities. None of
 * these are required — they exist so creators / buyers can pin an
 * order to a specific IP / episode / crew context, and so the
 * platform can later aggregate "all the work that flowed through
 * IP X".
 *
 * Nullable on every column; the UI exposes them as optional
 * dropdowns at create time.
 */
export interface OrderBindings {
  /** IP (project) this work is being made for. */
  ipId?: string | null;
  /** Specific episode under that IP. */
  episodeId?: string | null;
  /** Crew this work is fulfilling for. */
  crewId?: string | null;
  /** Specific crew recruitment position. */
  crewPositionId?: string | null;
}

// ─── DTOs ────────────────────────────────────────────────────

export interface OrderDTO {
  id: string;
  buyerId: string;
  creatorId: string;
  /** Service the order originated from. */
  serviceId: string;
  /** Package within the service the buyer chose. */
  packageSnapshot: OrderPackageSnapshot;

  status: OrderStatus;

  /** Snapshot of the buyer's answers to creator-defined questions. */
  questionnaire: OrderQuestionnaireEntry[];

  /** Conversation thread for this order (always populated — every
   *  order has its own conversation, evolved from the service
   *  inquiry conversation it was born from). */
  conversationId: string;

  bindings: OrderBindings;

  /** Optimistic concurrency token bumped on every server write. */
  version: number;

  /** Lifecycle timestamps. NULL until the corresponding transition
   *  fires; useful for the order detail timeline. */
  createdAt: string;
  acceptedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelInfo: OrderCancelInfo | null;
}

/**
 * Inbox / list projection — drops the snapshots + questionnaire so
 * the list endpoint stays cheap.
 */
export interface OrderCardDTO {
  id: string;
  serviceId: string;
  serviceTitle: string;
  packageTier: ServiceTier;
  status: OrderStatus;
  /** From the package snapshot — drives the "$N" chip on the card. */
  totalPrice: number;
  currency: CurrencyCode;
  /** Counterparty (whichever side the viewer isn't). */
  counterpartyId: string;
  counterpartyRole: OrderParticipantRole;
  /** ms timestamp of the latest activity (status change OR last
   *  conversation message), for inbox ordering. */
  lastActivityAt: string;
  /** Unread message count for the viewer on this order's conv. */
  unreadCount: number;
}

// ─── Transition guards ───────────────────────────────────────

const TERMINAL: Set<OrderStatus> = new Set(["completed", "cancelled"]);

export function isOrderTerminal(s: OrderStatus): boolean {
  return TERMINAL.has(s);
}

/**
 * Whether the given action is valid in the given state. Used by
 * both client (gating buttons) and server (rejecting bad
 * transitions). Keeping this in shared/ prevents the two from
 * drifting.
 */
export const ORDER_TRANSITIONS: Record<
  OrderStatus,
  Partial<
    Record<
      "accept" | "decline" | "deliver" | "accept_delivery" | "request_revision" | "cancel",
      OrderStatus
    >
  >
> = {
  pending_creator: {
    accept: "in_progress",
    decline: "cancelled",
    cancel: "cancelled",
  },
  in_progress: {
    deliver: "delivered",
    cancel: "cancelled",
  },
  delivered: {
    accept_delivery: "completed",
    request_revision: "revision_requested",
    cancel: "cancelled",
  },
  revision_requested: {
    deliver: "delivered",
    cancel: "cancelled",
  },
  completed: {},
  cancelled: {},
};

export type OrderAction = keyof (typeof ORDER_TRANSITIONS)["pending_creator"];

export function canTransition(status: OrderStatus, action: OrderAction): boolean {
  return ORDER_TRANSITIONS[status][action] !== undefined;
}

export function nextStatus(status: OrderStatus, action: OrderAction): OrderStatus | null {
  return ORDER_TRANSITIONS[status][action] ?? null;
}
