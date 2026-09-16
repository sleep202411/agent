/**
 * Character library (角色库) request/response contracts.
 *
 * The wire shapes mirror `apps/studio/lib/characters-api.ts` VERBATIM — that
 * client is the authoritative consumer contract. Ownership model
 * (docs/character-library-real-person-portraits-design-v1.md): a character
 * belongs to its home WORKSPACE (演员池); a project sees only its CAST
 * (演员表). Real-person creation and enrollment use feature, region and
 * consent gates; subject withdrawal remains a distinct lifecycle action.
 */
import { z } from 'zod';

export const CharacterKindSchema = z.enum(['virtual', 'real_person']);
export type CharacterKindInput = z.infer<typeof CharacterKindSchema>;

/** Prompt-facing label (@mention) — unique per workspace among live rows. */
const CharacterNameSchema = z.string().trim().min(1).max(64);
const CharacterDescriptionSchema = z.string().trim().max(200);

export const CreateCharacterSchema = z.object({
  workspaceId: z.string().uuid(),
  kind: CharacterKindSchema,
  name: CharacterNameSchema,
  description: CharacterDescriptionSchema.optional(),
  /** Auto-cast the new character into this project (same workspace only). */
  castProjectId: z.string().uuid().optional(),
  /**
   * real_person only (design §2.1a/§2.4): acceptance of the versioned
   * consent screen + the intl adult attestation. The server validates the
   * version against its canonical copy and appends the `consent_granted`
   * ledger record BEFORE the character row exists.
   */
  consent: z
    .object({
      version: z.string().trim().min(1).max(64),
      adultAttested: z.literal(true),
    })
    .optional(),
});
export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>;

export const UpdateCharacterSchema = z.object({
  name: CharacterNameSchema.optional(),
  description: CharacterDescriptionSchema.nullable().optional(),
  /** Must reference one of the character's attached media assets, or null. */
  coverAssetId: z.string().uuid().nullable().optional(),
});
export type UpdateCharacterInput = z.infer<typeof UpdateCharacterSchema>;

export const ListCharactersQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});
export type ListCharactersQuery = z.infer<typeof ListCharactersQuerySchema>;

export const CharacterIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type CharacterIdParams = z.infer<typeof CharacterIdParamsSchema>;

export const CharacterMediaParamsSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
});
export type CharacterMediaParams = z.infer<typeof CharacterMediaParamsSchema>;

export const AttachCharacterMediaSchema = z.object({
  mediaAssetId: z.string().uuid(),
});
export type AttachCharacterMediaInput = z.infer<
  typeof AttachCharacterMediaSchema
>;

/** Full list of CharacterMedia ids in the desired order (no partial sets). */
export const ReorderCharacterMediaSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(15),
});
export type ReorderCharacterMediaInput = z.infer<
  typeof ReorderCharacterMediaSchema
>;

export const ProjectCastParamsSchema = z.object({
  projectId: z.string().uuid(),
});
export type ProjectCastParams = z.infer<typeof ProjectCastParamsSchema>;

export const ProjectCastMemberParamsSchema = z.object({
  projectId: z.string().uuid(),
  characterId: z.string().uuid(),
});
export type ProjectCastMemberParams = z.infer<
  typeof ProjectCastMemberParamsSchema
>;

export const CastCharacterSchema = z.object({
  characterId: z.string().uuid(),
});
export type CastCharacterInput = z.infer<typeof CastCharacterSchema>;

// ─── Response DTOs (mirror apps/studio/lib/characters-api.ts) ───

export type CharacterKindDto = 'virtual' | 'real_person';
export type CharacterStatusDto =
  | 'draft'
  | 'pending_verification'
  | 'active'
  | 'disabled'
  | 'revoked';
export type CharacterMediaKindDto = 'image' | 'video' | 'audio';

/** Provider-mirror readiness of one media row (real_person only). */
export interface CharacterMediaMirrorDto {
  status:
    | 'pending'
    | 'processing'
    | 'active'
    | 'failed'
    | 'disabled'
    | 'deleted';
  statusReason: string | null;
}

export interface CharacterMediaItemDto {
  id: string;
  mediaAssetId: string;
  mediaKind: CharacterMediaKindDto;
  sortOrder: number;
  /** Present iff the character has a provider mirror plane (real_person). */
  mirror?: CharacterMediaMirrorDto;
}

// ─── Enrollment (real_person liveness) ───

export interface EnrollmentSessionDto {
  sessionId: string;
  h5Link: string;
  expiresAt: string;
}

export type EnrollmentSessionStatusDto =
  | 'none'
  | 'pending'
  | 'completed'
  | 'failed'
  | 'expired';

export interface EnrollmentStatusDto {
  sessionStatus: EnrollmentSessionStatusDto;
  characterStatus: CharacterStatusDto;
  expiresAt?: string;
}

// ─── Per-project likeness authorization grants (v2) ───

/** Versioned consent affirmation the client captures on the grant screen. */
const GrantConsentSchema = z.object({
  version: z.string().trim().min(1).max(64),
  adultAttested: z.literal(true),
});

export const GrantProjectSchema = z.object({
  projectId: z.string().uuid(),
  consent: GrantConsentSchema,
});
export type GrantProjectInput = z.infer<typeof GrantProjectSchema>;

export const GrantProjectParamsSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
});
export type GrantProjectParams = z.infer<typeof GrantProjectParamsSchema>;

/** Optional project scope for the subject's likeness-output views (§6). */
export const LikenessOutputsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
});
export type LikenessOutputsQuery = z.infer<typeof LikenessOutputsQuerySchema>;

/** Subject takedown scope: a project, a single job, or all of their outputs. */
export const LikenessTakedownSchema = z.object({
  projectId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
});
export type LikenessTakedownInput = z.infer<typeof LikenessTakedownSchema>;

export interface ProjectGrantDto {
  id: string;
  projectId: string;
  projectName: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
}

// ─── B2 casting invites (director invites an actor to lend a likeness) ───

export const CreateCastingInviteSchema = z
  .object({
    /** A known FizzDragon user to invite (bound; only they can accept). */
    inviteeUserId: z.string().trim().min(1).max(64).optional(),
    /** Off-platform contact for an open invite link (email/handle). */
    inviteeContact: z.string().trim().min(1).max(256).optional(),
  })
  .refine((v) => v.inviteeUserId || v.inviteeContact, {
    message: 'Provide inviteeUserId or inviteeContact.',
  });
export type CreateCastingInviteInput = z.infer<
  typeof CreateCastingInviteSchema
>;

export const CastingInviteProjectParamsSchema = z.object({
  projectId: z.string().uuid(),
});
export type CastingInviteProjectParams = z.infer<
  typeof CastingInviteProjectParamsSchema
>;

export const CastingInviteMemberParamsSchema = z.object({
  projectId: z.string().uuid(),
  inviteId: z.string().uuid(),
});
export type CastingInviteMemberParams = z.infer<
  typeof CastingInviteMemberParamsSchema
>;

export const CastingInviteTokenParamsSchema = z.object({
  token: z.string().trim().min(1).max(256),
});
export type CastingInviteTokenParams = z.infer<
  typeof CastingInviteTokenParamsSchema
>;

export const AcceptCastingInviteSchema = z.object({
  /** The actor's own active real_person character to lend to the project. */
  characterId: z.string().uuid(),
  consent: GrantConsentSchema,
});
export type AcceptCastingInviteInput = z.infer<
  typeof AcceptCastingInviteSchema
>;

export type CastingInviteStatusDto =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'revoked';

/** Director's view of a casting invite (never leaks the raw token). */
export interface CastingInviteDto {
  id: string;
  projectId: string;
  inviteeUserId: string | null;
  inviteeContact: string | null;
  status: CastingInviteStatusDto;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
}

/** Result of creating an invite — the raw token is returned ONCE. */
export interface CastingInviteCreatedDto {
  id: string;
  token: string;
  expiresAt: string;
}

/** Actor's token-gated preview before accepting. */
export interface CastingInvitePreviewDto {
  projectId: string;
  projectName: string;
  status: CastingInviteStatusDto;
  expiresAt: string;
  /** True once the actor should pick a character (or enroll first). */
  acceptable: boolean;
}

export interface CharacterSummaryDto {
  id: string;
  workspaceId: string;
  kind: CharacterKindDto;
  name: string;
  description: string | null;
  coverAssetId: string | null;
  status: CharacterStatusDto;
  createdByUserId: string;
  mediaCounts: { image: number; video: number; audio: number };
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDetailDto extends CharacterSummaryDto {
  media: CharacterMediaItemDto[];
}

export interface CastEntryDto {
  id: string;
  characterId: string;
  addedByUserId: string;
  createdAt: string;
  character: CharacterSummaryDto;
}

/** Per-kind media caps — mirrors Seedance 2.0 reference-to-video limits
 *  (≤9 images + ≤3 videos + ≤3 audio) — kept in lockstep with
 *  CHARACTER_MEDIA_CAPS in apps/studio/lib/characters-api.ts. */
export const CHARACTER_MEDIA_CAPS: Record<CharacterMediaKindDto, number> = {
  image: 9,
  video: 3,
  audio: 3,
};
