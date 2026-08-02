/**
 * Server-side user-avatar resolution — the single place that turns Java's raw
 * avatar value into a final, ready-to-use URL for clients.
 *
 * Rendering is server-specific, while the style, palette, placeholder and
 * seed policy come from `@repo/shared/avatar`, shared with web/studio/mobile.
 * This keeps generated fallback identity byte-identical across surfaces.
 *
 * @dicebear is ESM-only and apps/server compiles to CommonJS, so it's loaded
 * via dynamic import() — the repo's established ESM-interop pattern (see
 * main.ts / message-preprocess.ts). That makes the DiceBear helpers async.
 */

import {
  isPlaceholderUserAvatar,
  resolveUserAvatarUrl,
  USER_AVATAR_DICEBEAR_BACKGROUND_COLORS,
  userAvatarSeed,
} from '@repo/shared/avatar';

/** Per-region avatar OSS/CDN host (intl: user-aratar-sg OSS, cn: avatar.fizzspace.cn).
 *  Each deployment sets it; mirrors apps/web's NEXT_PUBLIC_USER_BASE_URL. */
const AVATAR_BASE = (process.env.USER_AVATAR_BASE_URL ?? '').replace(
  /\/+$/,
  '',
);

export function isPlaceholderAvatar(src: string | null | undefined): boolean {
  return isPlaceholderUserAvatar(src);
}

/** A custom (uploaded) avatar resolved to an absolute URL, or undefined if none. */
function resolveCustomAvatar(
  path: string | null | undefined,
): string | undefined {
  return resolveUserAvatarUrl(path, AVATAR_BASE);
}

/** Deterministic DiceBear data URI (mirrors apps/web getDicebearAvatar). */
export async function dicebearDataUri(seed: string): Promise<string> {
  const { createAvatar } = await import('@dicebear/core');
  const { notionists } = await import('@dicebear/collection');
  return createAvatar(notionists, {
    seed,
    backgroundColor: [...USER_AVATAR_DICEBEAR_BACKGROUND_COLORS],
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
    resolveCustomAvatar(rawAvatar) ??
    (await dicebearDataUri(userAvatarSeed(userId)))
  );
}
