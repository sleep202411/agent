import { MediaAssetModerationStatus } from '@prisma/client';

/**
 * Pre-broadcast moderation gate policy.
 *
 * In a collaborative document, one user's newly-referenced media asset would
 * otherwise resolve to a viewable URL on every PEER the instant it is shared —
 * before any moderation. That is a compliance liability (notably in CN), not an
 * edge case. When approval is required, a media asset is viewable by peers only
 * once moderation has APPROVED it; the asset's OWNER can always see their own
 * pending asset (so their own editing UX is unaffected). `blocked` assets are
 * withheld from everyone regardless — that is enforced separately at the access
 * layer and is independent of this policy.
 *
 * OFF by default — this preserves the default-allow-then-takedown posture. It is
 * enabled per region via `MEDIA_REQUIRE_MODERATION_APPROVAL=true`.
 *
 * IMPORTANT operational coupling: enabling this requires an approval workflow
 * that actually moves assets out of `unreviewed`. With no such workflow (e.g. a
 * cell running `DISABLE_CONTENT_MODERATION=true`), peer views would never resolve
 * — so enabling it is a deliberate, workflow-aware decision, not a default.
 */
export function requireModerationApproval(): boolean {
  const raw = process.env.MEDIA_REQUIRE_MODERATION_APPROVAL;
  if (raw == null || raw.trim() === '') return false;
  return raw.trim().toLowerCase() === 'true';
}

/**
 * Whether a non-owner ("peer") may receive a viewable URL for an asset, given
 * the approval policy. The owner is always allowed; `blocked` is handled upstream.
 */
export function isPeerViewable(
  moderationStatus: MediaAssetModerationStatus,
  isOwner: boolean,
  requireApproval: boolean,
): boolean {
  if (!requireApproval) return true;
  if (isOwner) return true;
  return moderationStatus === MediaAssetModerationStatus.approved;
}
