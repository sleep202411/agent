/**
 * Zod schemas for creator-service endpoints.
 *
 * Two-level nesting matches the wire shape — create/update operates
 * on a service envelope plus a 1-3 element packages array. Packages
 * are replace-all on PATCH: clients always send the full set they
 * want to keep, server diffs by tier and deletes the rest. Cheaper
 * than per-row PATCH for owner-driven editing, where re-saving the
 * tier table after every tweak is the common path.
 */
import { z } from 'zod';
import { ALL_CURRENCIES, type CurrencyCode } from '../common/currency';
import {
  CREATOR_SERVICE_STATUSES,
  SERVICE_CATEGORIES,
  SERVICE_TIERS,
  UNLIMITED_REVISIONS,
} from '@repo/shared/creator-service';

// ─── Package ────────────────────────────────────────────────

/**
 * Display unit (yuan / dollar / yen) — server converts to smallest
 * unit at the service layer based on the chosen currency.
 *
 * `revisions = -1` means unlimited. The Zod constraint is
 * `>= UNLIMITED_REVISIONS` to keep `-1` as the explicit sentinel
 * (vs. e.g. allowing `null` which would be a second representation
 * for the same idea).
 */
export const PackageInputSchema = z.object({
  tier: z.enum(SERVICE_TIERS),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
  currency: z.enum(ALL_CURRENCIES),
  /// Display unit. ≥ 0 (free packages allowed); ≤ 1e8 sanity cap.
  price: z.number().min(0).max(100_000_000),
  /// 1-365 calendar days.
  deliveryDays: z.number().int().min(1).max(365),
  /// -1 = unlimited; otherwise 0..200.
  revisions: z.number().int().min(UNLIMITED_REVISIONS).max(200).default(0),
  /// ≤ 12 bullets; each ≤ 200 chars after trim.
  scope: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});
export type PackageInput = z.infer<typeof PackageInputSchema>;

// ─── Requirement question ───────────────────────────────────

/**
 * One pre-order question. The on-the-wire shape mirrors
 * ServiceRequirementQuestionDTO; we re-use the schema for both
 * create and update because there's no per-row update path —
 * questionnaire edits are replace-all at the service level.
 */
export const QuestionInputSchema = z.object({
  /// Optional client-provided id. If absent, server mints one.
  /// Persisting an existing id is how the client preserves answer
  /// references through edits.
  id: z.string().trim().min(1).max(64).optional(),
  prompt: z.string().trim().min(1).max(240),
  helpText: z.string().trim().max(240).default(''),
  required: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(1000).default(0),
});
export type QuestionInput = z.infer<typeof QuestionInputSchema>;

// ─── Service envelope ───────────────────────────────────────

const ServiceBaseSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
  coverPath: z.string().trim().max(512).default(''),
  category: z.enum(SERVICE_CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(48)).max(10).default([]),
});

export const CreateServiceSchema = ServiceBaseSchema.extend({
  clientRequestKey: z.string().trim().min(8).max(64).optional(),
  /// Optional on create — a freshly drafted service may have zero
  /// packages yet. Publishing rejects services with empty packages.
  packages: z
    .array(PackageInputSchema)
    .max(3)
    .default([])
    .refine(uniqueTiers, {
      message: 'packages must have distinct tiers',
      path: ['packages'],
    }),
  /// Replace-all set of buyer-facing pre-order questions. Optional
  /// on create — services without a questionnaire just don't show
  /// one in the order flow. Same replace-all semantics as packages.
  requirementQuestions: z.array(QuestionInputSchema).max(20).default([]),
});
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

export const UpdateServiceSchema = ServiceBaseSchema.partial().extend({
  /// When provided, replaces the entire package set (replace-all
  /// semantics — see file header). When omitted, packages are left
  /// untouched.
  packages: z
    .array(PackageInputSchema)
    .max(3)
    .refine(uniqueTiers, {
      message: 'packages must have distinct tiers',
      path: ['packages'],
    })
    .optional(),
  /// Same replace-all semantics for the questionnaire. Omit to
  /// leave existing questions untouched.
  requirementQuestions: z.array(QuestionInputSchema).max(20).optional(),
  /// Optimistic concurrency token from the row read prior to edit.
  expectedVersion: z.number().int().min(0).optional(),
});
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

/// Status-transition body. We expose explicit publish/pause/resume/
/// archive endpoints instead of a generic PATCH status because:
///   - publish has a precondition (≥ 1 package) you'd otherwise
///     re-encode at every callsite,
///   - the verb maps cleanly to a button in the UI.
/// This schema is the empty body — kept around so a future "publish
/// with optional first-listed-at override" stays a one-field add.
export const PublishServiceSchema = z.object({}).default({});

// ─── Listing query ──────────────────────────────────────────

/// Plaza / category browse query.
export const ListServicesQuerySchema = z.object({
  creatorId: z.string().trim().min(1).max(64).optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  /// Substring search on title + tags. Server folds case + diacritics.
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(CREATOR_SERVICE_STATUSES).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type ListServicesQuery = z.infer<typeof ListServicesQuerySchema>;

// ─── Helpers ────────────────────────────────────────────────

function uniqueTiers(packages: { tier: string }[]): boolean {
  return new Set(packages.map((p) => p.tier)).size === packages.length;
}

/** Re-export so the service layer can branch on `revisions === UNLIMITED`. */
export { UNLIMITED_REVISIONS };
export type { CurrencyCode };
