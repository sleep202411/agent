import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTaskCommentAccess } from "./task-comment-api";
const uuid = z.string().uuid();
export const trustAppeal = z.object({
  id: uuid,
  taskId: uuid,
  submissionId: uuid,
  userId: z.string().min(1),
  reason: z.string(),
  status: z.enum(["pending", "upheld", "corrected"]),
  reviewReason: z.string().nullable(),
  points: z.number().int(),
  originalPoints: z.number().int(),
  currentCorrectionId: uuid.nullable(),
  submittedAt: z.string(),
  deadline: z.string().nullable(),
});
export type TrustAppeal = z.infer<typeof trustAppeal>;
const decisionSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("upheld"),
      reason: z.string().trim().min(1).max(2000),
      expectedCorrectionId: uuid.nullable(),
    })
    .strict(),
  z
    .object({
      decision: z.literal("corrected"),
      points: z.union([z.literal(200), z.literal(-200)]),
      reason: z.string().trim().min(1).max(2000),
      expectedCorrectionId: uuid.nullable(),
    })
    .strict(),
]);
export type TrustReview = z.infer<typeof decisionSchema>;
function current(generation: number, signal: AbortSignal) {
  if (generation !== getAuthGeneration() || signal.aborted)
    throw new Error("Trust appeal session expired");
}
function path(crewId: string) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  return `/crews/${crewId}/trust-appeals`;
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  current(generation, signal);
  path(crewId);
  const access = await fetchTaskCommentAccess(crewId, userId, signal);
  current(generation, signal);
  if (!access.canManage) throw new Error("Task management permission is required");
}
export async function fetchTrustAppeals(
  crewId: string,
  userId: string,
  generation: number,
  history: boolean,
  cursor: string | null,
  signal: AbortSignal
) {
  if (cursor !== null) uuid.parse(cursor);
  await authorize(crewId, userId, generation, signal);
  const result = z.object({ items: z.array(trustAppeal), nextCursor: uuid.nullable() }).parse(
    await api.get(path(crewId), {
      service: "aurora",
      signal,
      retry: false,
      params: { status: history ? "all" : "pending", ...(cursor ? { cursor } : {}) },
    })
  );
  current(generation, signal);
  if (
    new Set(result.items.map((a) => a.id)).size !== result.items.length ||
    (!history && result.items.some((a) => a.status !== "pending"))
  )
    throw new Error("Invalid appeal queue response");
  return result;
}
export async function reviewTrustAppeal(
  crewId: string,
  userId: string,
  generation: number,
  appealId: string,
  input: TrustReview,
  signal: AbortSignal
) {
  uuid.parse(appealId);
  const data = decisionSchema.parse(input);
  await authorize(crewId, userId, generation, signal);
  const receipt = z
    .object({ id: uuid, status: z.enum(["upheld", "corrected"]), correctionId: uuid.nullable() })
    .parse(
      await api.post(`${path(crewId)}/${appealId}/review`, {
        service: "aurora",
        signal,
        retry: false,
        data,
      })
    );
  current(generation, signal);
  if (
    receipt.id !== appealId ||
    receipt.status !== data.decision ||
    (receipt.status === "corrected") !== (receipt.correctionId !== null)
  )
    throw new Error("Review receipt mismatch. Refresh before reviewing again.");
  return receipt;
}
