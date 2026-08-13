"use client";

/**
 * ShotPictureGallery — the storyboard drawer's "图册" view.
 *
 * Renders a slot's candidate pictures as a MASONRY (Pinterest-style) layout:
 * two CSS columns, each item flowing at its own natural aspect ratio with no
 * cropping or forced equal height. This is the difference vs. a CSS Grid,
 * which would align items into equal-height rows and crop images to fill them.
 *
 * Hover (or keyboard focus) reveals per-item actions: mark as 定稿 (finalized)
 * and delete. The current 定稿 carries a permanent star badge.
 *
 * One file, two components: `ShotPictureGallery` (the column layout + empty
 * state) and `GalleryItem` (one picture card with its hover actions).
 */
import { useTranslations } from "next-intl";
import { IconLoader2, IconPhoto, IconStar, IconTrash } from "@tabler/icons-react";
import type { ShotPicture } from "./use-storyboard";

export function ShotPictureGallery({
  pictures,
  preferredEdgeId,
  onMarkFinalized,
  onDelete,
}: {
  pictures: ShotPicture[];
  /** The edge id marked 定稿; absent → the first picture is the cover. */
  preferredEdgeId?: string;
  onMarkFinalized: (edgeId: string) => void;
  onDelete: (edgeId: string) => void;
}) {
  const t = useTranslations("storyboard");

  if (pictures.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-white/30">
        <IconPhoto className="size-8" stroke={1.2} />
        <span className="text-xs">{t("drawer.galleryEmpty")}</span>
      </div>
    );
  }

  // `columns-2` = CSS multi-column layout → true masonry. Items keep their
  // natural height (no row alignment, no crop). `break-inside-avoid` stops an
  // item from splitting across columns.
  return (
    <div className="columns-2 gap-2 [column-fill:_balance]">
      {pictures.map((item) => (
        <GalleryItem
          key={item.edgeId}
          item={item}
          isPreferred={item.edgeId === (preferredEdgeId ?? pictures[0]?.edgeId)}
          onMarkFinalized={onMarkFinalized}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function GalleryItem({
  item,
  isPreferred,
  onMarkFinalized,
  onDelete,
}: {
  item: ShotPicture;
  isPreferred: boolean;
  onMarkFinalized: (edgeId: string) => void;
  onDelete: (edgeId: string) => void;
}) {
  const t = useTranslations("storyboard");
  return (
    <div className="group/item relative mb-2 break-inside-avoid overflow-hidden rounded-lg bg-white/[0.05]">
      {item.url ? (
        item.kind === "video" ? (
          <video src={item.url} muted playsInline className="block w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt="" className="block w-full" />
        )
      ) : item.status === "running" ? (
        <div className="flex aspect-square items-center justify-center">
          <IconLoader2 className="size-6 animate-spin text-white/40" stroke={1.6} />
        </div>
      ) : (
        <div className="flex aspect-square items-center justify-center text-white/20">
          <IconPhoto className="size-6" stroke={1.2} />
        </div>
      )}

      {/* 定稿 badge — top-left, always visible. */}
      {isPreferred && (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary/85 px-1.5 py-0.5 text-[0.625rem] font-semibold text-white shadow">
          <IconStar className="size-3 fill-current" />
        </span>
      )}

      {item.status === "failed" && (
        <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-destructive/80 px-1.5 py-0.5 text-[0.625rem] text-white">
          {item.error ?? t("drawer.emptySlot")}
        </span>
      )}

      {/* Hover / focus actions — top-right, fade in. */}
      <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 group-focus-within/item:opacity-100">
        {!isPreferred && (
          <button
            type="button"
            onClick={() => onMarkFinalized(item.edgeId)}
            title={t("drawer.markFinalized")}
            className="inline-flex size-7 items-center justify-center rounded-lg bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
          >
            <IconStar className="size-3.5" stroke={1.8} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(item.edgeId)}
          title={t("drawer.delete")}
          className="inline-flex size-7 items-center justify-center rounded-lg bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-destructive hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
        >
          <IconTrash className="size-3.5" stroke={1.8} />
        </button>
      </div>
    </div>
  );
}
