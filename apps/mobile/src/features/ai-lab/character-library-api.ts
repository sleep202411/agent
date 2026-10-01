import { z } from "zod";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import {
  loadAgentWorkspaces,
  canCreateStudioProject,
} from "@/features/agent/api/studio-projects-api";
import { generationSession } from "./jobs-api";
const id = z.string().uuid();
export const libraryCharacter = z.object({
  id,
  workspaceId: id,
  kind: z.enum(["virtual", "real_person"]),
  name: z.string(),
  description: z.string().nullable(),
  coverAssetId: id.nullable(),
  status: z.enum(["draft", "pending_verification", "active", "disabled", "revoked"]),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mediaCounts: z.object({
    image: z.number().int().nonnegative(),
    video: z.number().int().nonnegative(),
    audio: z.number().int().nonnegative(),
  }),
});
export const libraryDetail = libraryCharacter.extend({
  media: z.array(
    z.object({
      id,
      mediaAssetId: id,
      mediaKind: z.enum(["image", "video", "audio"]),
      sortOrder: z.number().int(),
      mirror: z
        .object({
          status: z.enum(["pending", "processing", "active", "failed", "disabled", "deleted"]),
          statusReason: z.string().nullable().optional(),
        })
        .optional(),
    })
  ),
});
export type LibraryCharacter = z.infer<typeof libraryCharacter>;
export type LibraryDetail = z.infer<typeof libraryDetail>;
export const libraryFields = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(200),
});
export async function loadCharacterLibrary(
  workspaceId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  id.parse(workspaceId);
  const rows = z.object({ items: z.array(libraryCharacter) }).parse(
    await api.get("/characters", {
      service: "aurora",
      params: { workspaceId },
      signal,
      retry: false,
    })
  ).items;
  generationSession(generation, signal);
  if (
    rows.some((r) => r.workspaceId !== workspaceId) ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw Error("Character library response does not match this workspace.");
  return rows;
}
export async function loadLibraryCharacter(
  workspaceId: string,
  characterId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  id.parse(workspaceId);
  id.parse(characterId);
  const row = libraryDetail.parse(
    await api.get(`/characters/${characterId}`, { service: "aurora", signal, retry: false })
  );
  generationSession(generation, signal);
  if (row.id !== characterId || row.workspaceId !== workspaceId)
    throw Error("Character response does not match your selection.");
  if (
    new Set(row.media.map((m) => m.id)).size !== row.media.length ||
    new Set(row.media.map((m) => m.mediaAssetId)).size !== row.media.length
  )
    throw Error("Duplicate character media. Refresh before continuing.");
  return row;
}
export const ENROLLMENT_CONSENT_VERSION = "realperson-consent-v1-2026-07-02";
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), clientKey: id, workspaceId: id, fields: libraryFields }),
  z.object({
    action: z.literal("create-likeness"),
    clientKey: id,
    workspaceId: id,
    fields: libraryFields,
    consent: z.object({
      version: z.literal(ENROLLMENT_CONSENT_VERSION),
      adultAttested: z.literal(true),
    }),
  }),
  z.object({
    action: z.literal("edit"),
    clientKey: id,
    workspaceId: id,
    before: libraryCharacter,
    fields: libraryFields,
  }),
  z.object({
    action: z.literal("remove"),
    clientKey: id,
    workspaceId: id,
    before: libraryCharacter,
  }),
]);
export type LibraryCommand = z.infer<typeof command>;
export const characterLibraryBox = (userId: string, generation: number, workspaceId: string) =>
  pendingRequest(
    command,
    generation,
    durableRecord("character-library", userId, id.parse(workspaceId))
  );
export function prepareLibraryCommand(value: LibraryCommand) {
  return command.parse(value);
}
export function prepareLikenessCreation(
  workspaceId: string,
  fields: z.infer<typeof libraryFields>,
  clientKey: string,
  read: boolean,
  adultAttested: boolean
) {
  if (!read || !adultAttested)
    throw Error(
      "Read the enrollment consent and attest to your own adult likeness before continuing."
    );
  return command.parse({
    action: "create-likeness",
    workspaceId,
    fields,
    clientKey,
    consent: { version: ENROLLMENT_CONSENT_VERSION, adultAttested: true },
  });
}
/** No server request key or revision lock: retain uncertain writes, never infer success from absence. */
export async function submitLibraryCommand(
  value: LibraryCommand,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = command.parse(value),
    box = characterLibraryBox(userId, generation, intent.workspaceId);
  if (box.read())
    throw Error("Review the original character request before making another change.");
  const workspace = (await loadAgentWorkspaces(signal)).find((w) => w.id === intent.workspaceId);
  generationSession(generation, signal);
  if (!workspace || !canCreateStudioProject(workspace))
    throw Error("Workspace editor permission is required.");
  if (intent.action === "create-likeness" && !workspace.isDefault)
    throw Error("Enroll your likeness in your personal default workspace.");
  if (intent.action === "edit" || intent.action === "remove") {
    const fresh = await loadLibraryCharacter(
      intent.workspaceId,
      intent.before.id,
      generation,
      signal
    );
    if (JSON.stringify(libraryCharacter.parse(fresh)) !== JSON.stringify(intent.before))
      throw Error("The character changed. Refresh and review your change again.");
    if (intent.action === "edit" && ["disabled", "revoked"].includes(fresh.status))
      throw Error("This character cannot be edited.");
    if (
      intent.action === "remove" &&
      !["owner", "admin"].includes(workspace.role ?? "") &&
      fresh.createdByUserId !== userId
    )
      throw Error("Only a workspace administrator or the character creator can remove it.");
  }
  box.save(intent);
  if (intent.action === "remove") {
    z.object({ removed: z.literal(true) }).parse(
      await api.delete(`/characters/${intent.before.id}`, {
        service: "aurora",
        signal,
        retry: false,
      })
    );
    generationSession(generation, signal);
    box.clear(intent.clientKey);
    return null;
  }
  const raw =
    intent.action !== "edit"
      ? await api.post("/characters", {
          service: "aurora",
          signal,
          retry: false,
          data: {
            workspaceId: intent.workspaceId,
            kind: intent.action === "create-likeness" ? "real_person" : "virtual",
            ...intent.fields,
            ...(intent.action === "create-likeness" ? { consent: intent.consent } : {}),
          },
        })
      : await api.patch(`/characters/${intent.before.id}`, {
          service: "aurora",
          signal,
          retry: false,
          data: { name: intent.fields.name, description: intent.fields.description || null },
        });
  const receipt = libraryDetail.parse(raw);
  generationSession(generation, signal);
  if (
    receipt.workspaceId !== intent.workspaceId ||
    receipt.name !== intent.fields.name ||
    (receipt.description ?? "") !== intent.fields.description ||
    (intent.action === "edit"
      ? receipt.id !== intent.before.id
      : receipt.kind !== (intent.action === "create-likeness" ? "real_person" : "virtual"))
  )
    throw Error("The character receipt does not match your request. Review the library.");
  box.clear(intent.clientKey);
  return receipt;
}
