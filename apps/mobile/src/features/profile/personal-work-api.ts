import { appEnv, resolveAssetUrl } from "@/config";
import { api } from "@/lib/api-client";
/** Resolve permission-checked playback; never construct URLs from private bucket keys. */
export async function getPersonalWorkLink(id: string, signal?: AbortSignal): Promise<string> {
  if (!id.trim()) throw new Error("Missing work ID");
  const raw = await api.postForm<unknown>(
    "/vedio/play/personal/getLink",
    { id },
    { service: "content", signal }
  );
  if (typeof raw !== "string" || !raw.trim()) throw new Error("No playable video");
  const url = new URL(raw.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Invalid playback link");
  return url.href;
}

export type PublicPersonalWork = { id: string; title: string; coverUrl?: string };
export const PERSONAL_WORK_PAGE_SIZE = 20;
export async function getCreatorPersonalWorks(
  creatorId: string,
  page: number,
  signal?: AbortSignal
) {
  if (!creatorId.trim() || !Number.isSafeInteger(page) || page < 1)
    throw new Error("Invalid work list request");
  const raw = await api.postForm<unknown>(
    "/vedio/query/user/personal",
    {
      userId: creatorId,
      page: String(page),
      pageSize: String(PERSONAL_WORK_PAGE_SIZE),
    },
    { service: "content", signal }
  );
  if (!Array.isArray(raw)) throw new Error("Invalid work list response");
  const works: PublicPersonalWork[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if ((typeof row.id !== "string" && typeof row.id !== "number") || !String(row.id).trim())
      continue;
    // Defense in depth for a public surface; private rows are not portfolio cards.
    if (row.viewStatus != null && String(row.viewStatus) !== "1") continue;
    works.push({
      id: String(row.id),
      title: typeof row.title === "string" ? row.title : "",
      coverUrl:
        typeof row.videoBanner === "string" && row.videoBanner.trim()
          ? resolveAssetUrl(row.videoBanner, appEnv.assets.bannerBaseUrl)
          : undefined,
    });
  }
  return { works, hasMore: raw.length >= PERSONAL_WORK_PAGE_SIZE };
}
