import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { crewEpisode } from "./episode-management-api";
const uuid = z.string().uuid();
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const episodeDelivery = z.object({
  id: uuid,
  episodeId: uuid,
  versionNumber: z.number().int().positive(),
  assetNodeId: uuid,
  status: z.enum(["submitted", "approved", "rejected"]),
  note: z.string(),
  reviewNote: z.string(),
  submittedByUserId: z.string(),
  reviewedByUserId: z.string().nullable(),
  reviewedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  asset: z.object({
    name: z.string(),
    kind: z.string().nullable(),
    contentType: z.string().nullable(),
    sizeBytes: z.number().nonnegative().nullable(),
    durationSeconds: z.number().nonnegative().nullable(),
  }),
});
export type EpisodeDelivery = z.infer<typeof episodeDelivery>;
export async function fetchEpisodeDelivery(
  crewId: string,
  episodeId: string,
  userId: string,
  signal: AbortSignal
) {
  crew.parse(crewId);
  uuid.parse(episodeId);
  const [raw, membership] = await Promise.all([
    api.get(`/crews/${crewId}/episodes`, { service: "aurora", signal }),
    api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }),
  ]);
  const rows = z.array(crewEpisode.extend({ deliveries: z.array(episodeDelivery) })).parse(raw);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(membership);
  if (
    member.userId !== userId ||
    rows.some((row) => row.crewId !== crewId) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Episode delivery scope mismatch");
  const episode = rows.find((row) => row.id === episodeId);
  if (!episode) throw new Error("Episode no longer available");
  const deliveries = episode.deliveries;
  if (
    deliveries.some((row) => row.episodeId !== episodeId) ||
    new Set(deliveries.map((row) => row.id)).size !== deliveries.length ||
    new Set(deliveries.map((row) => row.versionNumber)).size !== deliveries.length
  )
    throw new Error("Episode delivery history mismatch");
  return {
    episode,
    canSubmit: member.permissions.includes("production.deliver"),
    canReview: member.permissions.includes("production.review"),
  };
}
function session(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Episode delivery session expired");
}
export async function submitEpisodeDelivery(
  episodeId: string,
  assetNodeId: string,
  note: string,
  userId: string,
  generation: number
) {
  uuid.parse(episodeId);
  uuid.parse(assetNodeId);
  const data = { assetNodeId, note: z.string().trim().max(10000).parse(note) };
  session(generation);
  const result = episodeDelivery.parse(
    await api.post(`/crew-episodes/${episodeId}/deliveries`, { service: "aurora", data })
  );
  session(generation);
  if (
    result.episodeId !== episodeId ||
    result.assetNodeId !== assetNodeId ||
    result.submittedByUserId !== userId ||
    result.status !== "submitted" ||
    result.note !== data.note
  )
    throw new Error("Episode delivery response mismatch. Refresh before continuing.");
  return result;
}
export async function reviewEpisodeDelivery(
  delivery: EpisodeDelivery,
  decision: "approve" | "reject",
  note: string,
  userId: string,
  generation: number
) {
  uuid.parse(delivery.id);
  z.enum(["approve", "reject"]).parse(decision);
  const data = { decision, note: z.string().trim().max(10000).parse(note) };
  if (delivery.status !== "submitted" || (decision === "reject" && !data.note))
    throw new Error("A submitted delivery and revision note are required for rejection");
  session(generation);
  const result = episodeDelivery.parse(
    await api.post(`/crew-episode-deliveries/${delivery.id}/review`, { service: "aurora", data })
  );
  session(generation);
  if (
    result.id !== delivery.id ||
    result.episodeId !== delivery.episodeId ||
    result.assetNodeId !== delivery.assetNodeId ||
    result.versionNumber !== delivery.versionNumber ||
    result.status !== (decision === "approve" ? "approved" : "rejected") ||
    result.reviewedByUserId !== userId ||
    !result.reviewedAt ||
    result.reviewNote !== data.note
  )
    throw new Error("Episode review response mismatch. Refresh before continuing.");
  return result;
}
export async function fetchEpisodeVideo(crewId: string, nodeId: string, signal: AbortSignal) {
  crew.parse(crewId);
  uuid.parse(nodeId);
  const { node } = z
    .object({
      node: z.object({
        id: uuid,
        kind: z.literal("file"),
        status: z.literal("active"),
        name: z.string(),
        media: z.object({ id: uuid, kind: z.literal("video"), contentType: z.string() }),
      }),
    })
    .parse(await api.get(`/crews/${crewId}/assets/nodes/${nodeId}`, { service: "aurora", signal }));
  if (node.id !== nodeId) throw new Error("Episode video scope mismatch");
  return node;
}
