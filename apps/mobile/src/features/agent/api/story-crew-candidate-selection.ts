import { storyCandidates, type CandidateScope } from "./story-candidates-api";
import { loadStoryCrewCandidates } from "./story-crew-candidates";

/** Resolve a Crew choice to a confirmed candidate before the consumer binds it.
 * A lost add response never implies that the subsequent binding ran. */
export async function resolveCrewCandidate(
  scope: CandidateScope,
  userId: string,
  mediaAssetId: string,
  allowedKinds: readonly ("image" | "video")[],
  clientKey: string,
  signal: AbortSignal
) {
  const client = storyCandidates(scope, userId);
  const state = await client.load(signal);
  if (!state.canEdit) throw Error("Story editing permission is required.");
  const pending = state.pending;
  if (pending && (pending.action !== "add" || pending.mediaAssetId !== mediaAssetId))
    throw Error("Finish the pending candidate update in Saved candidates first.");
  const valid = (item: (typeof state.items)[number]) => {
    if (
      !allowedKinds.some((kind) => kind === item.asset.kind) ||
      item.asset.status !== "ready" ||
      item.asset.moderationStatus === "blocked"
    )
      throw Error("This media cannot be used in this slot.");
    return item;
  };
  const saved = state.items.find((item) => item.asset.id === mediaAssetId);
  if (saved) return valid(saved);
  const crew = await loadStoryCrewCandidates(scope, signal);
  const source = crew.items.find((item) => item.media?.id === mediaAssetId);
  if (!source || !allowedKinds.some((kind) => kind === source.media?.kind))
    throw Error("This Crew media is no longer available for this slot. Refresh to try again.");
  const next = await client.submit(pending ?? { clientKey, mediaAssetId, action: "add" }, signal);
  const candidate = next.items.find((item) => item.asset.id === mediaAssetId);
  if (!candidate) throw Error("Candidate import could not be verified. Refresh to try again.");
  return valid(candidate);
}
