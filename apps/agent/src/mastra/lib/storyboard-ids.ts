/**
 * Shared helpers for resolving user-facing names (scene / character
 * names) into Java worldscene / worldrole ids for storyboard writes.
 *
 * Used by the update_storyboard_row / add_shot / delete_shot /
 * batch_update_storyboard_rows tools and by the storyboard_phase
 * backfill step. Centralised here so the "Java's create/worldscene
 * returns data as a bare string, not an {id} object" quirk only lives
 * in one place.
 */
import { javaRequest, type StoryosContext } from "./workspace-client";

/**
 * Resolve a scene name → worldscene id. Looks up the existing list
 * first (case-insensitive); creates a new worldscene if no match.
 *
 * Java's `/create/worldscene` responds with the new id as a bare
 * string in `data` (`{ success, data: "1413" }`); older Studio builds
 * returned an `{ id }` object. Accept both.
 *
 * Pass a shared `cache` map to amortise lookups across multiple shots
 * in the same run (keyed by `name.toLowerCase().trim()`).
 */
export async function resolveSceneIdByName(
  ctx: StoryosContext,
  worldId: string,
  sceneName: string,
  cache?: Map<string, string>
): Promise<string> {
  const trimmed = sceneName.trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase();
  const cached = cache?.get(key);
  if (cached) return cached;

  try {
    const listResp = await javaRequest<{
      list?: Array<{ id?: string | number; name?: string }>;
    }>(ctx, "/api/user/world/list/worldscene", {
      data: { worldId, page: 1, pageSize: 200 },
    });
    const match = (listResp?.list ?? []).find(
      (s) =>
        String(s.name ?? "")
          .trim()
          .toLowerCase() === key
    );
    if (match?.id != null) {
      const id = String(match.id);
      cache?.set(key, id);
      return id;
    }
  } catch {
    // fall through to create
  }

  const created = await javaRequest<unknown>(ctx, "/api/user/world/create/worldscene", {
    data: { worldId, name: trimmed, description: "", prompt: "" },
  });
  const id =
    typeof created === "string" || typeof created === "number"
      ? String(created)
      : String((created as { id?: string | number } | null)?.id ?? "");
  if (id) cache?.set(key, id);
  return id;
}

/**
 * Resolve character names → worldrole ids. Unlike scene, unknown
 * names are NOT auto-created — characters carry prompt / voice /
 * portrait that shouldn't be silently synthesised from a bare name.
 * Missing names come back in the `missing` array so the caller can
 * surface them.
 *
 * Pass a shared `cache` (name → id) to avoid re-listing per shot.
 */
export async function resolveCharacterIdsByNames(
  ctx: StoryosContext,
  worldId: string,
  names: string[],
  cache?: Map<string, string>
): Promise<{ ids: string[]; missing: string[] }> {
  const trimmed = names.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length === 0) return { ids: [], missing: [] };

  const resolved: string[] = [];
  const toFetch: string[] = [];
  for (const name of trimmed) {
    const key = name.toLowerCase();
    const cached = cache?.get(key);
    if (cached) resolved.push(cached);
    else toFetch.push(name);
  }
  if (toFetch.length === 0) return { ids: resolved, missing: [] };

  const resp = await javaRequest<{
    list?: Array<{ id?: string | number; name?: string }>;
  }>(ctx, "/api/user/world/list/worldrole", {
    data: { worldId, page: 1, pageSize: 200 },
  });
  const byName = new Map<string, string>();
  for (const role of resp?.list ?? []) {
    const name = String(role.name ?? "")
      .trim()
      .toLowerCase();
    if (name && role.id != null) byName.set(name, String(role.id));
  }

  const missing: string[] = [];
  for (const name of toFetch) {
    const key = name.toLowerCase();
    const id = byName.get(key);
    if (id) {
      resolved.push(id);
      cache?.set(key, id);
    } else {
      missing.push(name);
    }
  }
  return { ids: resolved, missing };
}
