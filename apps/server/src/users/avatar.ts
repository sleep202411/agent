/**
 * Server-side user-avatar resolution — the single place that turns Java's raw
 * avatar value into a final, ready-to-use URL for clients.
 *
 * Mirrors apps/web's user-avatar.tsx EXACTLY (DiceBear `notionists`, same
 * background palette, same placeholder-UUID rule, same `user:<id>` seed) so a
 * user's generated fallback face is byte-identical across web and studio.
 *
 * @dicebear is ESM-only and apps/server compiles to CommonJS, so it's loaded
 * via dynamic import() — the repo's established ESM-interop pattern (see
 * main.ts / message-preprocess.ts). That makes the DiceBear helpers async.
 */

/** Per-region avatar OSS/CDN host (intl: user-aratar-sg OSS, cn: avatar.fizzspace.cn).
 *  Each deployment sets it; mirrors apps/web's NEXT_PUBLIC_USER_BASE_URL. */
const AVATAR_BASE = (process.env.USER_AVATAR_BASE_URL ?? '').replace(
  /\/+$/,
  '',
);

/** Legacy default-avatar PNG baked into the user OSS bucket — treat as "no avatar". */
const PLACEHOLDER_AVATAR_UUID = 'd17b1d5e-282e-47e0-bd99-9a72477adf93';

/** DiceBear's recommended default palette — matches apps/web. */
const DICEBEAR_BG_PALETTE = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'];

export function isPlaceholderAvatar(src: string | null | undefined): boolean {
  if (!src) return true;
  return src.includes(PLACEHOLDER_AVATAR_UUID);
}

/** A custom (uploaded) avatar resolved to an absolute URL, or undefined if none. */
function resolveCustomAvatar(
  path: string | null | undefined,
): string | undefined {
  if (!path || isPlaceholderAvatar(path)) return undefined;
  if (path.startsWith('http')) return path; // already absolute
  if (!AVATAR_BASE) return undefined; // no base configured → fall through to DiceBear
  return `${AVATAR_BASE}/${path.replace(/^\/+/, '')}`;
}

/** Deterministic DiceBear data URI (mirrors apps/web getDicebearAvatar). */
export async function dicebearDataUri(seed: string): Promise<string> {
  const { createAvatar } = await import('@dicebear/core');
  const { notionists } = await import('@dicebear/collection');
  return createAvatar(notionists, {
    seed,
    backgroundColor: DICEBEAR_BG_PALETTE,
  }).toDataUri();
}

/**
 * Final avatar URL for a user: the resolved custom image when present, else a
 * deterministic DiceBear face seeded by `user:<id>` (identical to apps/web).
 */
export async function resolveUserAvatar(
  rawAvatar: string | null | undefined,
  userId: string | number,
): Promise<string> {
  return (
    resolveCustomAvatar(rawAvatar) ?? (await dicebearDataUri(`user:${userId}`))
  );
}
