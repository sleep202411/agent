import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { candidateSchema } from "./story-timeline-media";
import type { CandidateScope } from "./story-candidates-api";

/** Refresh the project-authorized DTO used by Web instead of assuming that
 * project-only collaborators also have a workspace/Crew media-access grant. */
export async function fetchStoryCandidatePlayback(
  scope: CandidateScope,
  mediaAssetId: string,
  kind: "audio" | "video",
  signal: AbortSignal
) {
  const current = () => {
    signal.throwIfAborted();
    z.string().uuid().parse(scope.projectId);
    z.string().uuid().parse(mediaAssetId);
    if (getAuthGeneration() !== scope.generation) throw Error("Story session expired.");
  };
  current();
  const items = z.array(candidateSchema).parse(
    await api.get(`/story-projects/${scope.projectId}/candidate-assets`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  current();
  if (new Set(items.map((item) => item.asset.id)).size !== items.length)
    throw Error("Duplicate project media returned.");
  const asset = items.find((item) => item.asset.id === mediaAssetId)?.asset;
  if (
    !asset ||
    asset.kind !== kind ||
    asset.status !== "ready" ||
    asset.moderationStatus === "blocked" ||
    !asset.previewUrl
  )
    throw Error("This candidate is no longer available for playback. Refresh to try again.");
  const url = new URL(asset.previewUrl);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw Error("Invalid candidate playback URL.");
  return url.href;
}
