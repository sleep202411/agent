import type { AuthUser } from "@/lib/auth";
import type { CollabUser } from "./use-collab-doc";

/** Deterministic, evenly-spread color from a stable seed (shared by all modes). */
export function collabColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 60%)`;
}

/** Map the signed-in user to the collaborative cursor / avatar identity. */
export function toCollabUser(user: AuthUser | null): CollabUser | null {
  if (!user) return null;
  const id = String(user.id ?? "anon");
  return {
    id,
    name: user.nickName?.trim() || "Guest",
    color: collabColor(id),
    avatarUrl: user.avatar,
  };
}
