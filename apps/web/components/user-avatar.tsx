"use client";

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";
import {
  isPlaceholderUserAvatar,
  resolveUserAvatarUrl as resolveSharedUserAvatarUrl,
  USER_AVATAR_DICEBEAR_BACKGROUND_COLORS,
  userAvatarSeed,
} from "@repo/shared/avatar";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";

/**
 * Resolve a stored avatar value into a browser-loadable URL for
 * `<UserAvatar src>`. Backend user lookups (e.g. `LookupUserDTO.avatar`)
 * return a bare OSS object path with **no base prefix**; handed straight to
 * an `<img>` it resolves against the web origin and 404s. This prefixes the
 * user/OSS base (mirrors the crews avatar handling). Already-absolute URLs
 * pass through; empty / missing returns `undefined` so `UserAvatar` falls
 * through to its DiceBear fallback.
 */
export function resolveUserAvatarUrl(path: string | null | undefined): string | undefined {
  return resolveSharedUserAvatarUrl(path, env.USER_BASE_URL || env.OSS_BASE_URL);
}

/**
 * Deterministic DiceBear SVG data URI. Pure function, safe to call in
 * render. Used both by `<UserAvatar>` as its fallback and by non-component
 * callers (notifications, OG images, etc.) that need a stable visual for
 * a user/entity id without going through React.
 *
 * `seed` should be a stable identifier (user id, crew id, …). The same
 * seed always produces the same SVG, so the user sees the same generated
 * face across refreshes and devices.
 *
 * Caller passes a raw seed; namespacing (`user:`, `crew:`, …) is the
 * caller's responsibility for this low-level helper. `<UserAvatar>`
 * wraps it and prefixes `user:` automatically.
 */
// DiceBear `notionists` ships with a transparent background by default,
// which leaves the line-art "floating" against whatever's behind the
// avatar. Passing `backgroundColor` makes DiceBear pick a deterministic
// pastel from the palette per seed — same user always gets the same
// background, and the figure now has a proper Notion-style coloured
// circle behind it. Palette matches DiceBear's recommended default.
export function getDicebearAvatar(seed: string | number): string {
  return createAvatar(notionists, {
    seed: String(seed),
    backgroundColor: [...USER_AVATAR_DICEBEAR_BACKGROUND_COLORS],
  }).toDataUri();
}

/**
 * Backend stores a specific placeholder PNG for users who never uploaded
 * an avatar (legacy default image baked into the user OSS bucket). Treat
 * it as "no avatar set" so the DiceBear fallback kicks in instead of
 * rendering the generic silhouette.
 *
 * We match by UUID `includes` (not `endsWith`) so this also fires when
 * the URL carries an OSS image-processing query string
 * (`?x-oss-process=image/resize,w_120` etc), or when the bucket / prefix
 * differs across deployments. Brittle to add new placeholders later, but
 * a single UUID is unambiguous enough.
 *
 * Exported so other callers (profile-completion checks, condition for a
 * "Upload avatar" CTA, etc.) can apply the same rule without re-deriving
 * the magic string.
 */
export function isPlaceholderAvatar(src: string | null | undefined): boolean {
  return isPlaceholderUserAvatar(src);
}

interface UserAvatarProps {
  /** Avatar URL or backend OSS object path. Relative paths are resolved
   *  against USER_BASE_URL here so callers cannot accidentally render a
   *  broken same-origin image. Empty / missing → DiceBear fallback. */
  src?: string | null;
  /** Stable seed for the DiceBear fallback (typically user id). When omitted
   *  we fall back to `name`, then to the literal string "anon" — the avatar
   *  stays consistent for that string but won't match across users. */
  seed?: string | number;
  /** Used as alt text and as a secondary seed fallback. */
  name?: string;
  /** Maps to Radix `<Avatar size>`. Accepts a number for arbitrary px sizes
   *  (rendered via inline style — overrides the default). */
  size?: "sm" | "default" | "lg" | number;
  /** Applied to the outer Radix Avatar root. Use this to override `size-*`,
   *  rounding (e.g. `rounded-2xl`), borders, etc. tailwind-merge handles
   *  the conflict with the primitive's defaults. */
  className?: string;
  /** Applied to the inner <img>. Use this when overriding rounding on the
   *  root (so the image inside matches the shape — Radix's `<AvatarImage>`
   *  defaults to `rounded-full` which clips DiceBear / real photos into a
   *  circle even if the outer is `rounded-2xl`). */
  imageClassName?: string;
}

export function UserAvatar({
  src,
  seed,
  name,
  size = "default",
  className,
  imageClassName,
}: UserAvatarProps) {
  // `user:` namespace so a numeric `1` here can never collide with the
  // same id from a future crew / project / character DiceBear use.
  // Auto-increment user ids are short by themselves but still produce
  // well-distributed avatars once hashed.
  const effectiveSeed = userAvatarSeed(seed ?? name ?? "anon");
  // DiceBear is synchronous + pure, but the data URI is a few KB string;
  // memoize so re-renders of a long list don't regenerate per row.
  const fallbackUri = useMemo(() => getDicebearAvatar(effectiveSeed), [effectiveSeed]);

  const radixSize = typeof size === "number" ? "default" : size;
  const sizeStyle = typeof size === "number" ? { width: size, height: size } : undefined;
  // Treat the backend placeholder PNG the same as a missing src so we
  // always fall through to the DiceBear fallback instead of rendering
  // the generic stock image.
  const effectiveSrc = isPlaceholderAvatar(src) ? undefined : resolveUserAvatarUrl(src);

  // Avoid the "DiceBear flash → real avatar" swap by ONLY rendering the
  // DiceBear fallback when there is genuinely no avatar URL to load.
  // When `effectiveSrc` exists, Radix's loading state still needs a
  // fallback slot to reserve the box — we render an empty neutral
  // (`bg-muted`) placeholder for that case. On a slow load the user sees
  // a brief grey square instead of a DiceBear face that's about to be
  // replaced; on load failure they keep seeing the grey square (rare).
  return (
    // `overflow-hidden` is necessary because Radix's Avatar root keeps a
    // `rounded-full` shape but doesn't clip children — the DiceBear SVG
    // ships at its own aspect ratio with an opaque background, so without
    // clipping the square corners of the fallback bleed past the circle.
    // tailwind-merge lets the caller override `rounded-full` to e.g.
    // `rounded-2xl` (talent card) and the clipping shape follows.
    <Avatar size={radixSize} className={cn("overflow-hidden", className)} style={sizeStyle}>
      {effectiveSrc ? (
        <>
          <AvatarImage src={effectiveSrc} alt={name ?? ""} className={cn(imageClassName)} />
          <AvatarFallback className={cn("bg-muted", imageClassName)} />
        </>
      ) : (
        <AvatarFallback className={cn("bg-transparent", imageClassName)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URI fallback */}
          <img src={fallbackUri} alt={name ?? ""} className={cn("h-full w-full", imageClassName)} />
        </AvatarFallback>
      )}
    </Avatar>
  );
}
