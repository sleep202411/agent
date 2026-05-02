/**
 * Shared `/vedio/type/tag/list` reader.
 *
 * Lifted out of feature-private hooks (IPs plaza filter chips +
 * personal-video publish dialog both consume the same endpoint with the
 * same flat-tag shape). Promoted to `src/hooks/` per the explicit
 * sharing decision — adding a third caller should reuse this hook
 * rather than reimplement the parser.
 *
 * Why bypass `api.get`: the shared client unwraps to `body.data`
 * (api-client.ts:177), and the field we actually need (`all`) lives
 * at the envelope's top level alongside `data`. Reading the raw
 * response sidesteps the unwrap so we get the flat
 * `{ tagId: tagName }` dictionary directly.
 */
import { useQuery } from "@tanstack/react-query";

export interface Tag {
  id: number;
  name: string;
}

/**
 * Raw shape of `/vedio/type/tag/list`. Backend also surfaces `data`
 * (category-grouped name arrays) and `map` (category-grouped id maps),
 * but neither carries information `all` doesn't, so we ignore them.
 */
interface RawTagListResponse {
  all?: Record<string, string>;
}

export const tagListKeys = {
  all: ["tag-list"] as const,
};

export function useTagList() {
  return useQuery<Tag[]>({
    queryKey: tagListKeys.all,
    queryFn: async () => {
      const res = await fetch("/vedio/type/tag/list", {
        credentials: "include",
        headers: tagListHeaders(),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as RawTagListResponse;
      const out: Tag[] = [];
      for (const [idStr, name] of Object.entries(json.all ?? {})) {
        const id = Number(idStr);
        if (Number.isFinite(id) && typeof name === "string" && name.length > 0) {
          out.push({ id, name });
        }
      }
      return out;
    },
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Minimal headers mirroring what `api-client` would set for an
 * authenticated GET — same locale + bearer token, just without the
 * response unwrap.
 */
function tagListHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof document !== "undefined") {
    const lang = document.documentElement.lang;
    if (lang) headers["accept-language"] = lang;
    const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
    headers.Authorization = `Bearer ${match?.[1] ?? ""}`;
  }
  return headers;
}
