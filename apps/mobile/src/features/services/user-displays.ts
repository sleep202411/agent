import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/api-client";
const display = z.object({
  userId: z.string(),
  nickname: z.string(),
  avatar: z.string().nullable(),
});
const response = z.object({ users: z.array(display) });
export type UserDisplay = z.infer<typeof display>;
export function displayIds(ids: readonly string[]) {
  return [...new Set(ids.filter((id) => /^\d{1,18}$/.test(id)))].sort();
}
export async function fetchUserDisplays(ids: readonly string[], signal: AbortSignal) {
  const unique = displayIds(ids);
  const users = new Map<string, UserDisplay>();
  for (let offset = 0; offset < unique.length; offset += 50) {
    if (signal.aborted) throw new Error("User display request cancelled");
    const chunk = unique.slice(offset, offset + 50);
    const result = response.parse(
      await api.get("/users/by-ids", {
        service: "aurora",
        signal,
        params: { ids: chunk.join(",") },
      })
    );
    for (const user of result.users) if (chunk.includes(user.userId)) users.set(user.userId, user);
  }
  return users;
}
/** Display enrichment is optional; never hide orders/messages if a profile lookup fails. */
export function useUserDisplays(owner: string | undefined, ids: readonly string[]) {
  const stableIds = JSON.stringify(displayIds(ids));
  const key = JSON.stringify([owner, stableIds]);
  const [snapshot, setSnapshot] = useState<{ key: string; users: Map<string, UserDisplay> }>();
  useEffect(() => {
    if (!owner || stableIds === "[]") return;
    const controller = new AbortController();
    void fetchUserDisplays(JSON.parse(stableIds) as string[], controller.signal)
      .then((users) => {
        if (!controller.signal.aborted) setSnapshot({ key, users });
      })
      .catch(() => {
        /* Keep identity fallback; primary data loading remains independent. */
      });
    return () => controller.abort();
  }, [owner, stableIds, key]);
  return owner && snapshot?.key === key ? snapshot.users : undefined;
}
