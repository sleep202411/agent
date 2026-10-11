import { api } from "@/lib/api-client";
import { getLocale } from "@/i18n/locale-store";
type Asset = { kind?: string; url?: string | null; externalUrl?: string | null } | null;
type Channel = {
  id: string;
  trailerAsset?: Asset;
  episodes?: { trailerAsset?: Asset; mediaAsset?: Asset }[];
};
function playable(item: Channel) {
  return [
    item.trailerAsset,
    ...(item.episodes ?? []).map((e) => e.trailerAsset),
    ...(item.episodes ?? []).map((e) => e.mediaAsset),
  ].some((asset) => asset?.kind === "video" && !!asset.url);
}
/** Follow the public catalogue; never wrap or substitute a missing current IP.
 * The destination reloads detail/access instead of playing a catalogue URL. */
export async function findNextVideo(ipId: string, signal: AbortSignal): Promise<string | null> {
  let cursor: string | undefined;
  let found = false;
  const cursors = new Set<string>(),
    seen = new Set<string>();
  do {
    signal.throwIfAborted();
    const page = await api.get<{ items: Channel[]; nextCursor: string | null }>(
      "/ip-commerce/ips",
      {
        service: "aurora",
        params: { locale: getLocale(), limit: 20, cursor },
        signal,
      }
    );
    signal.throwIfAborted();
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.id === ipId) {
        found = true;
        continue;
      }
      if (found && playable(item)) return item.id;
    }
    if (!page.nextCursor) return null;
    if (cursors.has(page.nextCursor))
      throw new Error("Video catalogue returned a repeated cursor.");
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);
}
