/**
 * Deterministic default avatar — mirrors the web's `getDicebearAvatar`
 * (DiceBear `notionists`, same pastel background palette). The web bundles the
 * DiceBear lib for an inline data URI; on mobile we use the hosted HTTP API so
 * we don't pull the SVG toolchain into the bundle. Same seed → same face.
 *
 * Seed convention matches the web: callers pass a namespaced seed like
 * `user:<id>` so a user looks identical across web and app.
 */
const BACKGROUND_PALETTE = "b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf";

export function dicebearAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(
    seed
  )}&backgroundColor=${BACKGROUND_PALETTE}`;
}
