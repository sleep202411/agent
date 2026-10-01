import { z } from "zod";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { loadAgentWorkspaces } from "@/features/agent/api/studio-projects-api";
import { generationSession } from "./jobs-api";
import { castingTokenPattern } from "./casting-invite-link";
export const PROJECT_LIKENESS_CONSENT_VERSION = "realperson-grant-v1-2026-07-02";
const id = z.string().uuid(),
  tokenSchema = z.string().regex(castingTokenPattern);
const previewSchema = z.object({
  projectId: id,
  projectName: z.string(),
  status: z.enum(["pending", "accepted", "declined", "expired", "revoked"]),
  expiresAt: z.string().datetime({ offset: true }),
  acceptable: z.boolean(),
});
const likenessSchema = z.object({
  id,
  workspaceId: id,
  kind: z.enum(["virtual", "real_person"]),
  status: z.enum(["draft", "pending_verification", "active", "disabled", "revoked"]),
  name: z.string(),
  coverAssetId: id.nullable(),
  updatedAt: z.string(),
});
export type CastingReview = Awaited<ReturnType<typeof reviewCastingInvite>>;
export async function reviewCastingInvite(token: string, generation: number, signal: AbortSignal) {
  generationSession(generation, signal);
  tokenSchema.parse(token);
  const preview = previewSchema.parse(
    await api.get(`/casting-invites/${token}`, { service: "aurora", signal, retry: false })
  );
  generationSession(generation, signal);
  if (
    !preview.acceptable ||
    preview.status !== "pending" ||
    Date.parse(preview.expiresAt) <= Date.now()
  )
    throw new Error("This casting invitation is no longer available.");
  const workspaces = await loadAgentWorkspaces(signal);
  generationSession(generation, signal);
  const defaults = workspaces.filter((w) => w.isDefault);
  if (defaults.length !== 1)
    throw new Error("Your default workspace is unavailable. Refresh and try again.");
  const workspaceId = defaults[0].id;
  const all = z.object({ items: z.array(likenessSchema) }).parse(
    await api.get("/characters", {
      service: "aurora",
      params: { workspaceId },
      signal,
      retry: false,
    })
  ).items;
  generationSession(generation, signal);
  if (
    all.some((c) => c.workspaceId !== workspaceId) ||
    new Set(all.map((c) => c.id)).size !== all.length
  )
    throw new Error("Likeness library does not match your default workspace.");
  return {
    preview,
    workspaceId,
    likenesses: all.filter((c) => c.kind === "real_person" && c.status === "active"),
  };
}
const acceptance = z.object({
  clientKey: id,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceId: id,
  projectId: id,
  projectName: z.string(),
  characterId: id,
  characterName: z.string(),
  characterUpdatedAt: z.string(),
  expiresAt: z.string(),
  consent: z.object({
    version: z.literal(PROJECT_LIKENESS_CONSENT_VERSION),
    adultAttested: z.literal(true),
  }),
});
export type CastingAcceptance = z.infer<typeof acceptance>;
export const castingTokenHash = (token: string) =>
  bytesToHex(sha256(new TextEncoder().encode(tokenSchema.parse(token))));
export function castingAcceptanceBox(user: string, generation: number, token: string) {
  return pendingRequest(
    acceptance,
    generation,
    durableRecord("casting-acceptance", user, castingTokenHash(token))
  );
}
export function prepareCastingAcceptance(
  token: string,
  review: CastingReview,
  characterId: string,
  clientKey: string,
  consentRead: boolean,
  adultAttested: boolean
): CastingAcceptance {
  const character = review.likenesses.find((c) => c.id === characterId);
  if (!character || !consentRead || !adultAttested)
    throw new Error("Review the consent and confirm your own adult likeness before accepting.");
  return acceptance.parse({
    clientKey,
    tokenHash: castingTokenHash(token),
    workspaceId: review.workspaceId,
    projectId: review.preview.projectId,
    projectName: review.preview.projectName,
    characterId,
    characterName: character.name,
    characterUpdatedAt: character.updatedAt,
    expiresAt: review.preview.expiresAt,
    consent: { version: PROJECT_LIKENESS_CONSENT_VERSION, adultAttested: true },
  });
}
export async function acceptCastingInvitation(
  token: string,
  command: CastingAcceptance,
  user: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = acceptance.parse(command);
  if (intent.tokenHash !== castingTokenHash(token))
    throw new Error("Casting invitation changed. Review it again.");
  const box = castingAcceptanceBox(user, generation, token);
  if (box.read())
    throw new Error("The original acceptance is awaiting review and will not be submitted again.");
  const fresh = await reviewCastingInvite(token, generation, signal),
    character = fresh.likenesses.find((c) => c.id === intent.characterId);
  if (
    !character ||
    fresh.workspaceId !== intent.workspaceId ||
    fresh.preview.projectId !== intent.projectId ||
    fresh.preview.projectName !== intent.projectName ||
    fresh.preview.expiresAt !== intent.expiresAt ||
    character.updatedAt !== intent.characterUpdatedAt ||
    character.name !== intent.characterName
  )
    throw new Error("The invitation or likeness changed. Refresh and review the consent again.");
  box.save(intent);
  z.object({ ok: z.literal(true) }).parse(
    await api.post(`/casting-invites/${token}/accept`, {
      service: "aurora",
      signal,
      retry: false,
      data: { characterId: intent.characterId, consent: intent.consent },
    })
  );
  generationSession(generation, signal);
  box.clear(intent.clientKey);
}
