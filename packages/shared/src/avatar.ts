/**
 * Cross-runtime user-avatar policy.
 *
 * Rendering remains platform-owned (DOM in web/studio, React Native in
 * mobile), while URL normalization and deterministic fallback identity live
 * here so every surface interprets the same backend value the same way.
 */

/** Legacy generic avatar stored in the user bucket; treat it as unset. */
export const USER_AVATAR_PLACEHOLDER_UUID = "d17b1d5e-282e-47e0-bd99-9a72477adf93";

/** DiceBear policy shared by inline (web/server) and hosted (mobile) renders. */
export const USER_AVATAR_DICEBEAR_STYLE = "notionists" as const;
export const USER_AVATAR_DICEBEAR_BACKGROUND_COLORS = [
  "b6e3f4",
  "c0aede",
  "d1d4f9",
  "ffd5dc",
  "ffdfbf",
] as const;

export function userAvatarSeed(userId: string | number): string {
  return `user:${String(userId)}`;
}

export function isPlaceholderUserAvatar(value: string | null | undefined): boolean {
  if (!value) return true;
  return value.includes(USER_AVATAR_PLACEHOLDER_UUID);
}

/**
 * Turn a backend avatar value into an image source.
 *
 * - HTTP(S), protocol-relative, blob and image data URLs pass through.
 * - A bare OSS key is joined to the caller's region-specific base URL.
 * - Missing values, the legacy placeholder and a bare key without a base
 *   return `undefined`, allowing the platform renderer to show its fallback.
 */
export function resolveUserAvatarUrl(
  value: string | null | undefined,
  baseUrl?: string | null
): string | undefined {
  const avatar = value?.trim();
  if (!avatar || isPlaceholderUserAvatar(avatar)) return undefined;
  if (/^https?:\/\//i.test(avatar) || /^blob:/i.test(avatar) || /^data:image\//i.test(avatar)) {
    return avatar;
  }
  if (avatar.startsWith("//")) return `https:${avatar}`;

  const base = baseUrl?.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  return `${base}/${avatar.replace(/^\/+/, "")}`;
}

/** Hosted DiceBear fallback for runtimes that should not bundle the SVG generator. */
export function dicebearUserAvatarUrl(
  seed: string | number,
  format: "png" | "svg" = "png"
): string {
  const backgroundColor = USER_AVATAR_DICEBEAR_BACKGROUND_COLORS.join(",");
  return `https://api.dicebear.com/9.x/${USER_AVATAR_DICEBEAR_STYLE}/${format}?seed=${encodeURIComponent(
    String(seed)
  )}&backgroundColor=${backgroundColor}`;
}
