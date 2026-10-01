import { z } from "zod";
import { api, ApiRequestError } from "@/lib/api-client";
import { generationSession } from "./jobs-api";
import { libraryDetail, loadLibraryCharacter } from "./character-library-api";

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const sessionSchema = z.object({
  sessionId: id,
  h5Link: z.string(),
  expiresAt: timestamp,
});
const statusSchema = z.object({
  sessionStatus: z.enum(["none", "pending", "completed", "failed", "expired"]),
  characterStatus: libraryDetail.shape.status,
  expiresAt: timestamp.optional(),
});
export type EnrollmentSession = z.infer<typeof sessionSchema>;
export type EnrollmentStatus = z.infer<typeof statusSchema>;
export type EnrollmentScope = { workspaceId: string; characterId: string; generation: number };

function check(scope: EnrollmentScope, signal: AbortSignal) {
  generationSession(scope.generation, signal);
  id.parse(scope.workspaceId);
  id.parse(scope.characterId);
}
function endpoint(scope: EnrollmentScope, action: string) {
  return `/characters/${scope.characterId}/enrollment/${action}`;
}

/** The authenticated server supplies this capability URL. Never persist it,
 * attach app credentials to it, or offer a cross-device handoff. */
export function enrollmentOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("Invalid verification session URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("Invalid verification session URL.");
  return url.origin;
}

export function enrollmentErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (typeof error.code === "string" && !error.code.startsWith("HTTP_")) return error.code;
  try {
    const body: unknown = JSON.parse(error.responseBody ?? "null");
    return typeof body === "object" &&
      body !== null &&
      "code" in body &&
      typeof body.code === "string"
      ? body.code
      : null;
  } catch {
    return null;
  }
}

/** Each explicit start supersedes the previous provider session. No transport
 * retries: a lost reply must be reviewed through status, then explicitly restarted. */
export async function startEnrollment(scope: EnrollmentScope, signal: AbortSignal) {
  check(scope, signal);
  const character = await loadLibraryCharacter(
    scope.workspaceId,
    scope.characterId,
    scope.generation,
    signal
  );
  if (
    character.kind !== "real_person" ||
    !["draft", "pending_verification"].includes(character.status)
  )
    throw Error("Choose an unverified personal likeness before starting verification.");
  // Subject identity is enforced by the official endpoint, not inferred from
  // createdByUserId (the character creator is not an authorization contract).
  const raw = await api.post(endpoint(scope, "session"), {
    service: "aurora",
    signal,
    retry: false,
  });
  check(scope, signal);
  const session = sessionSchema.parse(raw);
  enrollmentOrigin(session.h5Link);
  if (Date.parse(session.expiresAt) <= Date.now()) throw Error("Verification session has expired.");
  return session;
}

/** Read-only with respect to enrollment creation. Status cannot recover H5 URLs
 * and must never be used by the client to mark a character verified. */
export async function loadEnrollmentStatus(scope: EnrollmentScope, signal: AbortSignal) {
  check(scope, signal);
  const raw = await api.get(endpoint(scope, "status"), { service: "aurora", signal, retry: false });
  check(scope, signal);
  return statusSchema.parse(raw);
}

/** Idempotent server-to-provider pull. No callback token or client status is
 * accepted; an embedded-frame callback may only trigger this authenticated call. */
export async function completeEnrollment(scope: EnrollmentScope, signal: AbortSignal) {
  check(scope, signal);
  const raw = await api.post(endpoint(scope, "complete"), {
    service: "aurora",
    signal,
    retry: false,
  });
  check(scope, signal);
  const detail = libraryDetail.parse(raw);
  if (
    detail.id !== scope.characterId ||
    detail.workspaceId !== scope.workspaceId ||
    detail.kind !== "real_person"
  )
    throw Error("Verification receipt does not match this likeness.");
  return detail;
}
