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
import { useCurrentUser } from "./use-user";
import { useLocale } from "@/src/i18n/i18n";

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
  const { user } = useCurrentUser();
  const locale = useLocale();
  return useQuery<Tag[]>({
    queryKey: [...tagListKeys.all, locale, user?.id ?? "guest"],
    queryFn: async ({ signal }) => {
      const headers: Record<string, string> = { "accept-language": locale };
      if (typeof document !== "undefined") {
        const match = document.cookie.match(/(?:^|;\s*)satoken=([^;]+)/);
        headers.Authorization = `Bearer ${match?.[1] ?? ""}`;
      }
      const response = await fetch("/vedio/type/tag/list", {
        credentials: "include",
        headers,
        signal,
      });
      if (!response.ok) return [];
      const json = (await response.json()) as RawTagListResponse;
      signal.throwIfAborted();
      const out: Tag[] = [];
      for (const [idStr, name] of Object.entries(json.all ?? {})) {
        const id = Number(idStr);
        if (Number.isSafeInteger(id) && id > 0 && typeof name === "string" && name.length > 0) {
          out.push({ id, name });
        }
      }
      return out;
    },
    staleTime: 10 * 60 * 1000,
  });
}
