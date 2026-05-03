/**
 * User lookup by email — backs the IP team-add dialog.
 *
 * The dialog wants a single deterministic answer: "is there a user
 * with this email, and if so, what's their userId?". The current
 * backend doesn't expose `/user/query/by-email` yet, so the queryFn
 * **mocks the lookup** for now — any well-formed email resolves to a
 * fake user (`userId` derived from a stable hash of the email so the
 * same input always returns the same id during dev).
 *
 * When the backend ships the real endpoint, swap `mockLookup` for a
 * fetch and keep the `UserLookupRow` shape — the dialog won't change.
 */

import { useQuery } from "@tanstack/react-query";

export interface UserLookupRow {
  userId: number;
  name: string;
  /** Raw avatar path the backend returned; resolved by the dialog. */
  avatar: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToInt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  // Stay within positive int32 range — userId is int64 on the wire but
  // we don't need huge values for mocked output.
  return Math.abs(h) % 1_000_000;
}

/** TODO: replace with the real backend lookup when shipped. */
async function mockLookup(email: string): Promise<UserLookupRow | null> {
  await new Promise((r) => setTimeout(r, 350));
  if (!EMAIL_RE.test(email)) return null;
  const userId = hashToInt(email.toLowerCase());
  const local = email.split("@")[0] ?? email;
  const name = local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ")
    .trim();
  return {
    userId,
    name: name || `User ${userId}`,
    avatar: "",
    email,
  };
}

export function useUserByEmail(email: string, enabled: boolean) {
  const trimmed = email.trim();
  return useQuery<UserLookupRow | null>({
    queryKey: ["ip", "userByEmail", trimmed.toLowerCase()],
    queryFn: () => mockLookup(trimmed),
    enabled: enabled && trimmed.length > 0,
    // Cache per-email so retyping the same address doesn't re-fire.
    staleTime: 1000 * 60,
    retry: false,
  });
}
