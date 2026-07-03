import { api, ApiRequestError } from "@/lib/api";

/**
 * Character library (角色库) client — wraps the NestJS `/aurora/characters`
 * + `/aurora/projects/:id/cast` routes (satoken cookie auth, `{code,data}`
 * envelope unwrapped by `api`).
 *
 * Ownership model (docs/character-library-real-person-portraits-design-v1.md):
 *  - a character belongs to its home WORKSPACE (library / 演员池);
 *  - a project sees only its CAST (演员表) — casting is the explicit,
 *    audited act of bringing a library character into one project;
 *  - `virtual` characters are usable immediately (URL refs);
 *  - `real_person` (P2) is consent-gated: create carries the versioned
 *    consent acceptance, then the enrollment routes drive the BytePlus
 *    liveness verification before the character turns `active`.
 *
 * Media rendering: character media are private MediaAssets — render them
 * through the existing access route (`characterMediaContentUrl`), never by
 * persisting signed URLs.
 */

export type CharacterKind = "virtual" | "real_person";
export type CharacterStatus = "draft" | "pending_verification" | "active" | "disabled" | "revoked";
export type CharacterMediaKind = "image" | "video" | "audio";

/** Provider-mirror readiness of one media row (real_person only — the
 *  BytePlus asset registration that must be `active` before generation). */
export type CharacterMirrorStatus =
  | "pending"
  | "processing"
  | "active"
  | "failed"
  | "disabled"
  | "deleted";

export interface CharacterMediaMirror {
  status: CharacterMirrorStatus;
  /** Typed upstream verdict when failed: face_mismatch | multi_face |
   *  moderation | stale | … */
  statusReason?: string | null;
}

export interface CharacterMediaItem {
  id: string;
  mediaAssetId: string;
  mediaKind: CharacterMediaKind;
  sortOrder: number;
  /** Present for real_person characters; absence = no mirror plane (virtual). */
  mirror?: CharacterMediaMirror;
}

export interface CharacterSummary {
  id: string;
  workspaceId: string;
  kind: CharacterKind;
  name: string;
  description: string | null;
  coverAssetId: string | null;
  status: CharacterStatus;
  createdByUserId: string;
  mediaCounts: { image: number; video: number; audio: number };
  createdAt: string;
  updatedAt: string;
}

export interface CharacterDetail extends CharacterSummary {
  media: CharacterMediaItem[];
}

export interface CastEntry {
  id: string;
  characterId: string;
  addedByUserId: string;
  createdAt: string;
  character: CharacterSummary;
}

/** Per-kind media caps — mirrors Seedance 2.0 reference-to-video limits
 *  (≤9 images + ≤3 videos + ≤3 audio, 12 files total) enforced server-side. */
export const CHARACTER_MEDIA_CAPS: Record<CharacterMediaKind, number> = {
  image: 9,
  video: 3,
  audio: 3,
};

/** Max characters attachable to one generation card. */
export const MAX_CHARACTERS_PER_GENERATION = 3;

/** The consent-copy version the client renders and sends on real_person
 *  create — MUST match the copy shown in the consent step verbatim; the
 *  server ledgers `{version, textHash}` as the PIPL 单独同意 evidence. */
export const REAL_PERSON_CONSENT_VERSION = "realperson-consent-v1-2026-07-02";

/** The per-project grant consent version — shown before granting a project the
 *  right to use a likeness (subject "Authorize a project" AND actor casting
 *  accept). Acceptance is implicit in the grant/accept POST; the server ledgers
 *  the record. The rendered copy must state the SAME clauses as this version. */
export const REAL_PERSON_GRANT_CONSENT_VERSION = "realperson-grant-v1-2026-07-02";

/**
 * Typed error code from a characters/enrollment route (e.g.
 * `CHARACTER_NAME_TAKEN`, `ENROLLMENT_NOT_COMPLETED`). Nest puts the code in
 * the error response body; `ApiRequestError.code` only carries `HTTP_<status>`
 * for non-2xx responses, so we parse the preserved body.
 */
export function characterApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (typeof error.code === "string" && !error.code.startsWith("HTTP_")) return error.code;
  if (!error.responseBody) return null;
  try {
    const body = JSON.parse(error.responseBody) as Record<string, unknown>;
    return typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** Browser-renderable URL for a character's media asset (redirects to a
 *  short-lived signed URL; safe to use as <img>/<video> src). */
export function characterMediaContentUrl(mediaAssetId: string): string {
  return `/aurora/media/assets/${encodeURIComponent(mediaAssetId)}/content`;
}

// ─── Library (workspace 演员池) ─────────────────────────

export async function listCharacters(workspaceId: string): Promise<CharacterSummary[]> {
  const data = await api.get<{ items: CharacterSummary[] }>(`/aurora/characters`, {
    params: { workspaceId },
  });
  return data.items;
}

export async function getCharacter(id: string): Promise<CharacterDetail> {
  return api.get<CharacterDetail>(`/aurora/characters/${encodeURIComponent(id)}`);
}

export interface CreateCharacterInput {
  workspaceId: string;
  kind: CharacterKind;
  name: string;
  description?: string;
  /** Auto-cast the new character into this project (must belong to the same workspace). */
  castProjectId?: string;
  /** REQUIRED for kind=real_person: acceptance of the versioned consent
   *  screen + the adult attestation. Server appends the `consent_granted`
   *  ledger record before creating the draft.
   *  Typed errors: 501 REAL_PERSON_NOT_AVAILABLE, 403 CN_REAL_PERSON_UNAVAILABLE,
   *  409 CHARACTER_NAME_TAKEN, 409 ACR_ENROLLMENT_PAUSED. */
  consent?: { version: string; adultAttested: true };
}

export async function createCharacter(input: CreateCharacterInput): Promise<CharacterDetail> {
  return api.post<CharacterDetail>(`/aurora/characters`, { data: input });
}

export async function updateCharacter(
  id: string,
  patch: { name?: string; description?: string | null; coverAssetId?: string | null }
): Promise<CharacterDetail> {
  return api.patch<CharacterDetail>(`/aurora/characters/${encodeURIComponent(id)}`, {
    data: patch,
  });
}

export async function deleteCharacter(id: string): Promise<void> {
  await api.delete(`/aurora/characters/${encodeURIComponent(id)}`);
}

// ─── Character media ────────────────────────────────────

export async function attachCharacterMedia(
  characterId: string,
  mediaAssetId: string
): Promise<CharacterDetail> {
  return api.post<CharacterDetail>(`/aurora/characters/${encodeURIComponent(characterId)}/media`, {
    data: { mediaAssetId },
  });
}

export async function removeCharacterMedia(
  characterId: string,
  characterMediaId: string
): Promise<CharacterDetail> {
  return api.delete<CharacterDetail>(
    `/aurora/characters/${encodeURIComponent(characterId)}/media/${encodeURIComponent(characterMediaId)}`
  );
}

/** Reorder media — `order` is the full list of CharacterMedia ids in the
 *  desired order (server rewrites sortOrder). */
export async function reorderCharacterMedia(
  characterId: string,
  order: string[]
): Promise<CharacterDetail> {
  return api.patch<CharacterDetail>(`/aurora/characters/${encodeURIComponent(characterId)}/media`, {
    data: { order },
  });
}

// ─── Real-person enrollment (BytePlus liveness) ─────────

export interface EnrollmentSession {
  sessionId: string;
  /** BytePlus-hosted H5 liveness flow — embedded IN-PAGE (same-session
   *  binding is a security control; never offer QR/mobile handoff). */
  h5Link: string;
  /** ISO timestamp; sessions live 30 minutes. */
  expiresAt: string;
}

export type EnrollmentSessionStatus = "pending" | "completed" | "failed" | "expired" | "none";

export interface EnrollmentStatus {
  sessionStatus: EnrollmentSessionStatus;
  characterStatus: string;
  expiresAt?: string;
}

/** Typed errors: 409 ENROLLMENT_ALREADY_COMPLETED, 429 RATE_LIMITED,
 *  409 ACR_ENROLLMENT_PAUSED. */
export async function createEnrollmentSession(characterId: string): Promise<EnrollmentSession> {
  return api.post<EnrollmentSession>(
    `/aurora/characters/${encodeURIComponent(characterId)}/enrollment/session`
  );
}

/** Idempotent server-pull completion (the server-stored session token is the
 *  sole authority — no client token). Flips the character `active` when the
 *  provider confirms. Typed errors: 409 ENROLLMENT_NOT_COMPLETED (keep
 *  polling status), 409 ENROLLMENT_SESSION_EXPIRED. */
export async function completeEnrollment(characterId: string): Promise<CharacterDetail> {
  return api.post<CharacterDetail>(
    `/aurora/characters/${encodeURIComponent(characterId)}/enrollment/complete`
  );
}

export async function getEnrollmentStatus(characterId: string): Promise<EnrollmentStatus> {
  return api.get<EnrollmentStatus>(
    `/aurora/characters/${encodeURIComponent(characterId)}/enrollment/status`
  );
}

// ─── Project grants (subject authorizes a project) ──────
//
// v2 collaborative likeness: a grant is a purpose-scoped consent that lets a
// PROJECT (as a mutable unit — any current editor can generate) use the
// subject's likeness. Grants are subject-controlled; the actor casting-invite
// flow (below) is how a director brings in an external face.

export type ProjectGrantStatus = "active" | "revoked";

export interface ProjectGrantDto {
  id: string;
  projectId: string;
  projectName: string;
  status: ProjectGrantStatus;
  createdAt: string;
  revokedAt: string | null;
}

/** The per-project grant consent acceptance sent on grant + casting-accept.
 *  `version` MUST equal {@link REAL_PERSON_GRANT_CONSENT_VERSION}; the server
 *  rejects a missing/mismatched consent with 400 CONSENT_REQUIRED. */
export interface GrantConsent {
  version: string;
  adultAttested: true;
}

/** Grant one of the caller's (subject's) real_person characters to a project.
 *  Requires: caller is the subject AND an editor of that project, plus the
 *  gated grant consent. Errors: 400 CONSENT_REQUIRED, 403 PROJECT_EDITOR_REQUIRED,
 *  403 CHARACTER_SUBJECT_MISMATCH, 404 PROJECT_NOT_FOUND, 409 CHARACTER_NOT_ACTIVE. */
export async function createProjectGrant(
  characterId: string,
  projectId: string,
  consent: GrantConsent
): Promise<ProjectGrantDto> {
  return api.post<ProjectGrantDto>(`/aurora/characters/${encodeURIComponent(characterId)}/grants`, {
    data: { projectId, consent },
  });
}

/** Real_person characters with an ACTIVE grant to a project — the picker unions
 *  these into the cast (generation is authorized via the grant, no cast row). */
export async function listGrantedCharacters(projectId: string): Promise<CharacterSummary[]> {
  const data = await api.get<{ items: CharacterSummary[] }>(
    `/aurora/projects/${encodeURIComponent(projectId)}/granted-characters`
  );
  return data.items;
}

/** Active + revoked grant history for a character. */
export async function listProjectGrants(characterId: string): Promise<ProjectGrantDto[]> {
  const data = await api.get<{ items: ProjectGrantDto[] }>(
    `/aurora/characters/${encodeURIComponent(characterId)}/grants`
  );
  return data.items;
}

/** Withdraw a grant — reachable even if the subject has left the project. */
export async function revokeProjectGrant(characterId: string, projectId: string): Promise<void> {
  await api.delete(
    `/aurora/characters/${encodeURIComponent(characterId)}/grants/${encodeURIComponent(projectId)}`
  );
}

// ─── Casting invites (director invites an actor) ────────

export type CastingInviteStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export interface CastingInviteDto {
  id: string;
  projectId: string;
  inviteeUserId: string | null;
  inviteeContact: string | null;
  status: CastingInviteStatus;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
}

/** Returned once at creation — the raw token never comes back on a later list. */
export interface CreatedCastingInvite {
  id: string;
  token: string;
  expiresAt: string;
}

export interface CastingInvitePreview {
  projectId: string;
  projectName: string;
  status: CastingInviteStatus;
  expiresAt: string;
  /** Server's verdict on whether the current caller may accept it now. */
  acceptable: boolean;
}

/** Director creates a casting invite (by platform user id OR external contact).
 *  Requires project editor. Returns the one-time token → build the accept link. */
export async function createCastingInvite(
  projectId: string,
  invitee: { inviteeUserId?: string; inviteeContact?: string }
): Promise<CreatedCastingInvite> {
  return api.post<CreatedCastingInvite>(
    `/aurora/projects/${encodeURIComponent(projectId)}/casting-invites`,
    { data: invitee }
  );
}

export async function listCastingInvites(projectId: string): Promise<CastingInviteDto[]> {
  const data = await api.get<{ items: CastingInviteDto[] }>(
    `/aurora/projects/${encodeURIComponent(projectId)}/casting-invites`
  );
  return data.items;
}

export async function revokeCastingInvite(projectId: string, inviteId: string): Promise<void> {
  await api.delete(
    `/aurora/projects/${encodeURIComponent(projectId)}/casting-invites/${encodeURIComponent(inviteId)}`
  );
}

/** Actor previews a casting invite by token (no auth to the project needed). */
export async function previewCastingInvite(token: string): Promise<CastingInvitePreview> {
  return api.get<CastingInvitePreview>(`/aurora/casting-invites/${encodeURIComponent(token)}`);
}

/** Actor accepts by lending their OWN active real_person character, plus the
 *  gated grant consent. Errors: 400 CONSENT_REQUIRED,
 *  409 ENROLLMENT_REQUIRED (no active likeness — enroll first),
 *  403 CASTING_INVITE_NOT_YOURS, 409 CASTING_INVITE_NOT_PENDING,
 *  403 CHARACTER_SUBJECT_MISMATCH. */
export async function acceptCastingInvite(
  token: string,
  characterId: string,
  consent: GrantConsent
): Promise<void> {
  await api.post(`/aurora/casting-invites/${encodeURIComponent(token)}/accept`, {
    data: { characterId, consent },
  });
}

/** Shareable accept link from the current origin — never hardcode a host. */
export function castingAcceptUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/casting/accept?token=${encodeURIComponent(token)}`;
}

// ─── Likeness outputs + takedown (subject control §6) ───

export interface LikenessOutputAsset {
  assetId: string;
  /** Browser-renderable access URL (short-lived-signed-url redirect). */
  url: string;
  mimeType: string;
  moderationStatus: string;
}

export interface LikenessOutputItem {
  jobId: string;
  projectId: string;
  status: string;
  createdAt: string;
  outputs: LikenessOutputAsset[];
}

/** Every video made from the subject's likeness (optionally one project). */
export async function listLikenessOutputs(
  characterId: string,
  projectId?: string
): Promise<LikenessOutputItem[]> {
  const data = await api.get<{ items: LikenessOutputItem[] }>(
    `/aurora/characters/${encodeURIComponent(characterId)}/outputs`,
    projectId ? { params: { projectId } } : undefined
  );
  return data.items;
}

/** Block (physical takedown) outputs made from the subject's likeness. No scope
 *  = all of them; `projectId` = one project; `jobId` = one job. */
export async function takedownLikenessOutputs(
  characterId: string,
  scope: { projectId?: string; jobId?: string }
): Promise<{ blocked: number }> {
  return api.post<{ blocked: number }>(
    `/aurora/characters/${encodeURIComponent(characterId)}/outputs/takedown`,
    { data: scope }
  );
}

// ─── Cast (project 演员表) ──────────────────────────────

export async function listCast(projectId: string): Promise<CastEntry[]> {
  const data = await api.get<{ items: CastEntry[] }>(
    `/aurora/projects/${encodeURIComponent(projectId)}/cast`
  );
  return data.items;
}

export async function castCharacter(projectId: string, characterId: string): Promise<CastEntry> {
  return api.post<CastEntry>(`/aurora/projects/${encodeURIComponent(projectId)}/cast`, {
    data: { characterId },
  });
}

export async function uncastCharacter(projectId: string, characterId: string): Promise<void> {
  await api.delete(
    `/aurora/projects/${encodeURIComponent(projectId)}/cast/${encodeURIComponent(characterId)}`
  );
}
