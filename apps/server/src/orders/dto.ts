/**
 * Zod schemas for orders REST surface.
 *
 * Two creation paths:
 *   - POST /orders            questionnaire-first submit
 *   - POST /orders/from-proposal/:cid/:mid    proposal-accept path
 *     (the conversation + proposal message already exist)
 */
import { z } from 'zod';
import { ORDER_STATUSES } from '@repo/shared/order';
import { SERVICE_TIERS } from '@repo/shared/creator-service';

/**
 * Answer to a single requirement question. Frontend builds this
 * array by walking ServiceRequirementQuestion[] in display order,
 * collecting the buyer's free-form answers.
 */
const AnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(64),
  answer: z.string().trim().max(4000).default(''),
});

/**
 * Phase 1b: bindings are intentionally rejected at the edge until
 * Phase 1c ships a real picker + per-entity ownership validation.
 * Schema columns + DTO shape stay so 1c is a one-line refine flip,
 * but any non-null binding from the wire today is a 400.
 *
 * The fields are still declared (not stripped) so an honest mistake
 * surfaces as a clear field error rather than silent drop.
 */
const BindingsSchema = z
  .object({
    ipId: z.string().trim().min(1).max(64).nullable().optional(),
    episodeId: z.string().trim().min(1).max(64).nullable().optional(),
    crewId: z.string().trim().min(1).max(64).nullable().optional(),
    crewPositionId: z.string().trim().min(1).max(64).nullable().optional(),
  })
  .refine((b) => !b.ipId && !b.episodeId && !b.crewId && !b.crewPositionId, {
    message:
      'Order bindings are not enabled yet (Phase 1c). Submit with no bindings for now.',
    path: ['bindings'],
  });

/**
 * Questionnaire-first submit. Buyer chose the tier; server snapshots
 * the package row at submit time.
 *
 * `idempotencyKey` is the client-minted UUID for the submit intent.
 * Same key resubmitted (double-click, retry, weak-network duplicate)
 * returns the original order instead of creating a duplicate. The
 * key is optional for backwards-compat with legacy callers, but
 * every new UI surface should set it.
 */
export const SubmitOrderSchema = z.object({
  expectedServiceVersion: z.number().int().min(0).optional(),
  serviceId: z.string().trim().min(1).max(64),
  packageTier: z.enum(SERVICE_TIERS),
  answers: z.array(AnswerSchema).max(20).default([]),
  bindings: BindingsSchema.default({}),
  /// Optional free-form note from the buyer (rendered as the first
  /// text message in the spawned conversation so the creator sees
  /// the buyer's voice before the structured questionnaire).
  note: z.string().trim().max(2000).default(''),
  /// Client-minted UUID per submit attempt; resending it on retry
  /// dedupes server-side.
  idempotencyKey: z.string().trim().min(8).max(64).optional(),
});
export type SubmitOrderInput = z.infer<typeof SubmitOrderSchema>;

/** Cancel — either party. Reason is required for the paper trail. */
export const CancelOrderSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

/** Decline (creator only, pending_creator → cancelled). */
export const DeclineOrderSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type DeclineOrderInput = z.infer<typeof DeclineOrderSchema>;

/** Request revision (buyer only). */
export const RequestRevisionSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type RequestRevisionInput = z.infer<typeof RequestRevisionSchema>;

/** List filters. role: 'buyer' / 'creator' / 'both'. */
export const ListOrdersQuerySchema = z.object({
  role: z.enum(['buyer', 'creator', 'both']).default('both'),
  status: z.enum(ORDER_STATUSES).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;
