"use client";

import { useTranslations } from "next-intl";
import { IconMusic } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { FizzAiReferenceKind } from "@/app/[locale]/canvas/_lib/generation-api";

/**
 * `@`-mention support shared by the studio composer and the canvas generation
 * card: a reference can be cited in the prompt as `@Image1`, `@Video2`, … so a
 * phrase binds to a specific attached reference (imagine.art-style targeting).
 */
export type MentionItem = {
  id: string;
  /** Token shown after the `@`, e.g. "Image1". */
  label: string;
  name?: string;
  kind: FizzAiReferenceKind;
  previewUrl?: string;
};

const LABEL_PREFIX: Record<FizzAiReferenceKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

/** Per-kind mention label, e.g. mentionLabel("image", 1) → "Image1". */
export function mentionLabel(kind: FizzAiReferenceKind, indexWithinKind: number): string {
  return `${LABEL_PREFIX[kind]}${indexWithinKind}`;
}

/**
 * Detect an active `@query` immediately left of the caret. Returns the `@`
 * offset and the typed query, or null when the caret isn't in a mention.
 */
export function mentionRange(
  value: string,
  caret: number
): { start: number; query: string } | null {
  const at = value.lastIndexOf("@", caret - 1);
  if (at === -1) return null;
  // Must be at the start or preceded by whitespace/punctuation (not mid-word).
  if (at > 0 && !/[\s.,;:!?(（"'“”]/.test(value[at - 1])) return null;
  const query = value.slice(at + 1, caret);
  if (query.length > 32 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

/** Dropdown of mentionable references. Caller positions it via `className`. */
export function MentionMenu({
  options,
  active,
  onPick,
  className,
}: {
  options: MentionItem[];
  active: number;
  onPick: (item: MentionItem) => void;
  className?: string;
}) {
  const t = useTranslations("generation");
  return (
    <div
      className={cn(
        "absolute z-50 w-64 rounded-2xl bg-[oklch(0.24_0_0)] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("uploadReferenceFirst")}</p>
      ) : (
        options.map((item, index) => (
          <button
            key={item.id}
            type="button"
            // Mousedown so the pick wins over the textarea blur.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
              index === active ? "bg-white/[0.08]" : "hover:bg-white/[0.06]"
            )}
          >
            <span className="size-8 shrink-0 overflow-hidden rounded-md bg-muted">
              {item.kind === "audio" ? (
                <span className="flex size-full items-center justify-center">
                  <IconMusic className="size-3.5 text-white/70" stroke={1.7} />
                </span>
              ) : item.kind === "video" ? (
                <video src={item.previewUrl} muted playsInline className="size-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt={item.label} className="size-full object-cover" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">@{item.label}</span>
              {item.name ? (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {item.name}
                </span>
              ) : null}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
