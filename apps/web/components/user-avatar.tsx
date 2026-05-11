"use client";

import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { lorelei } from "@dicebear/collection";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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
export function getDicebearAvatar(seed: string | number): string {
  return createAvatar(lorelei, { seed: String(seed) }).toDataUri();
}

/**
 * Backend stores this exact path for users who never uploaded an avatar
 * (legacy placeholder image baked into the user OSS bucket). Treat it as
 * "no avatar set" so the DiceBear fallback kicks in instead of rendering
 * the generic placeholder PNG.
 *
 * Exported so other callers (profile-completion checks, condition for a
 * "Upload avatar" CTA, etc.) can apply the same rule without re-deriving
 * the magic string.
 */
const PLACEHOLDER_AVATAR_PATH = "1/d17b1d5e-282e-47e0-bd99-9a72477adf93.png";

export function isPlaceholderAvatar(src: string | null | undefined): boolean {
  if (!src) return true;
  // Match against the suffix so this works whether `src` is the raw
  // backend path (`1/d17b…png`) or a fully-resolved URL
  // (`https://…/1/d17b…png`).
  return src.endsWith(PLACEHOLDER_AVATAR_PATH);
}

interface UserAvatarProps {
  /** Real avatar URL (already resolved against USER_BASE_URL by the caller).
   *  Empty / missing → falls through to the DiceBear fallback. */
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
  const effectiveSeed = `user:${seed ?? name ?? "anon"}`;
  // DiceBear is synchronous + pure, but the data URI is a few KB string;
  // memoize so re-renders of a long list don't regenerate per row.
  const fallbackUri = useMemo(() => getDicebearAvatar(effectiveSeed), [effectiveSeed]);

  const radixSize = typeof size === "number" ? "default" : size;
  const sizeStyle = typeof size === "number" ? { width: size, height: size } : undefined;
  // Treat the backend placeholder PNG the same as a missing src so we
  // always fall through to the DiceBear fallback instead of rendering
  // the generic stock image.
  const effectiveSrc = isPlaceholderAvatar(src) ? undefined : src;

  // Avoid the "DiceBear flash → real avatar" swap by ONLY rendering the
  // DiceBear fallback when there is genuinely no avatar URL to load.
  // When `effectiveSrc` exists, Radix's loading state still needs a
  // fallback slot to reserve the box — we render an empty neutral
  // (`bg-muted`) placeholder for that case. On a slow load the user sees
  // a brief grey square instead of a DiceBear face that's about to be
  // replaced; on load failure they keep seeing the grey square (rare).
  return (
    <Avatar size={radixSize} className={cn(className)} style={sizeStyle}>
      {effectiveSrc ? (
        <>
          <AvatarImage src={effectiveSrc} alt={name ?? ""} className={cn(imageClassName)} />
          <AvatarFallback className={cn("bg-muted", imageClassName)} />
        </>
      ) : (
        <AvatarFallback className={cn("bg-transparent", imageClassName)}>
          <img src={fallbackUri} alt={name ?? ""} className={cn("h-full w-full", imageClassName)} />
        </AvatarFallback>
      )}
    </Avatar>
  );
}
