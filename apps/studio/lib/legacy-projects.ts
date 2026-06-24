import { api } from "@/lib/api";

/**
 * The user's legacy Java projects, read by the Nest server straight from MySQL
 * (`GET /aurora/legacy-projects/my`) — no Java HTTP hop. `id` is a string (the
 * MySQL bigint cast to CHAR).
 */
export interface LegacyProject {
  id: string;
  name: string;
  cover: string | null;
  aspectRatio: string | null;
  status: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function listMyLegacyProjects(): Promise<LegacyProject[]> {
  // The endpoint caps each page at 100 (defaults to 50), so page through to
  // load the user's full history. The 2000 ceiling is a runaway guard.
  const all: LegacyProject[] = [];
  const PAGE = 100;
  for (let offset = 0; offset < 2000; offset += PAGE) {
    const data = await api.get<{ items: LegacyProject[] }>(
      `/aurora/legacy-projects/my?limit=${PAGE}&offset=${offset}`
    );
    all.push(...data.items);
    if (data.items.length < PAGE) break;
  }
  return all;
}

// ── Write operations ──────────────────────────────────────────────────────
// These hit the Java art-studio APIs directly (proxied via `/api/*` → Java
// studio), exactly as apps/web does. A "project" is a `worldproduct` living
// under a `world`; quick-create makes both in one shot, and deleting the last
// product in a world cascade-deletes the world.

/** Create a new project (world + first product). Returns the new ids. */
export async function createLegacyProject(
  name: string
): Promise<{ worldId: string; projectId: string }> {
  return api.post<{ worldId: string; projectId: string }>(
    "/api/user/world/create/quick/worldproduct",
    { data: { name: name.trim() } }
  );
}

/** Fields the worldproduct update round-trips (parity with apps/web's editor). */
interface LegacyProjectDetail {
  worldId?: string;
  name?: string;
  description?: string;
  imagePath?: string;
  aspectRatioType?: string;
  stylePainting?: string;
  type?: number;
  episode?: number;
  chapterLength?: number;
}

function getDetail(id: string): Promise<LegacyProjectDetail> {
  return api.post<LegacyProjectDetail>(`/api/user/project/detail/${encodeURIComponent(id)}`);
}

/**
 * Rename a project. The Java update replaces the worldproduct, so re-send the
 * current secondary fields (cover / episodes / style …) unchanged and only swap
 * the name — otherwise they'd be cleared.
 */
export async function renameLegacyProject(id: string, name: string): Promise<void> {
  const d = await getDetail(id);
  await api.post("/api/user/world/update/worldproduct", {
    data: {
      id,
      worldId: d.worldId,
      name: name.trim(),
      description: d.description ?? "",
      type: d.type,
      episode: d.episode,
      chapterLength: d.chapterLength,
      stylePainting: d.stylePainting,
      aspectRatioType: d.aspectRatioType,
      imagePath: d.imagePath,
    },
  });
}

/**
 * Delete a project. Java rejects deleting the LAST product in a world, so when
 * it's the only one we cascade-delete the world itself (matches apps/web).
 */
export async function deleteLegacyProject(id: string): Promise<void> {
  const { worldId } = await getDetail(id);
  let isLast = false;
  if (worldId) {
    const res = await api.post<{ list?: unknown[] }>("/api/user/world/list/worldproduct", {
      data: { page: 1, pageSize: 100, worldId },
    });
    isLast = (res.list ?? []).length <= 1;
  }
  if (isLast && worldId) {
    await api.post("/api/user/world/delete/world", { data: { id: worldId } });
  } else {
    await api.post(`/api/user/world/delete/worldproduct?id=${encodeURIComponent(id)}`);
  }
}
