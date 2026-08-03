"use client";

import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconLoader2,
  IconPhoto,
  IconPlayerPlayFilled,
  IconVideo,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { ShotRow } from "./use-storyboard";

/**
 * ONE picture slot of a shot — the still or the clip, each its own column.
 *
 * The slot renders from the WIRE feeding it rather than from the bound
 * reference alone, so a picture that is still generating shows its progress
 * here instead of an empty cell that silently fills in later. The cell is a
 * VIEW: one click opens the shot's picture drawer, where all the work happens.
 * Keeping actions out of the row is what lets the table stay a board you read
 * down instead of a grid of controls.
 */
export function ShotPictureCell({
  row,
  kind,
  selected,
  onOpen,
}: {
  row: ShotRow;
  kind: "image" | "video";
  selected: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("storyboard");
  const picture = row.pictures.find((candidate) => candidate.kind === kind);
  const EmptyIcon = kind === "video" ? IconVideo : IconPhoto;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t(kind === "video" ? "column.clip" : "column.frame")}
      aria-expanded={selected}
      className={cn(
        "group/slot -m-1 flex items-center rounded-lg p-1 transition-colors",
        "hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        selected && "bg-white/[0.07]"
      )}
    >
      <span
        className={cn(
          "relative flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-sm",
          // ONE empty look. A slot with a generation card wired but never run is
          // still empty from the board's point of view — and the next move is
          // the same as for an untouched slot, so it must not read as a
          // different state. Only running and failed earn their own treatment.
          picture?.url ? "bg-white/[0.07]" : "bg-white/[0.03]"
        )}
      >
        {/* Off-screen rows must cost nothing: a long board is dozens of media
            elements, and each eager one is a request on mount. Images defer to
            the browser's lazy loader; a clip loads NOTHING until asked, which is
            also why it carries a play glyph rather than pretending to be a frame. */}
        {picture?.url ? (
          kind === "video" ? (
            <>
              <video
                src={picture.url}
                muted
                playsInline
                preload="none"
                className="size-full bg-black/30 object-cover"
              />
              <IconPlayerPlayFilled className="absolute size-3.5 text-white/80 drop-shadow" />
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={picture.url}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          )
        ) : picture?.status === "failed" ? (
          <IconAlertTriangle className="size-4 text-destructive" stroke={1.7} />
        ) : (
          // Empty says WHAT belongs here — a still or a clip. Not a generic
          // "add" affordance: the whole cell is already the way in, and a plus
          // in a table cell reads as a control rather than a picture slot.
          <EmptyIcon
            className="size-4 text-white/20 transition-colors group-hover/slot:text-white/45"
            stroke={1.6}
          />
        )}
        {picture?.status === "running" ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50">
            <IconLoader2 className="size-4 animate-spin text-white/70" stroke={1.8} />
          </span>
        ) : null}
      </span>
    </button>
  );
}
