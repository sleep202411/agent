"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import {
  IconLoader2,
  IconMusic,
  IconMusicPlus,
  IconPhotoPlus,
  IconPlugConnected,
  IconVideoPlus,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import type {
  FizzAiReferenceFieldConstraints,
  FizzAiReferenceKind,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { MediaProviderStatusChipForAsset } from "./media-provider-status-chip";

export type CardReference = {
  id: string;
  url: string;
  name?: string;
  kind: FizzAiReferenceKind;
  /** Server MediaAsset id when this reference is backed by the asset library. */
  assetId?: string;
  /** Present when the reference came from a wired source node (vs an upload). */
  edgeId?: string;
  sourceNodeId?: string;
  /** Transient: an uploaded reference still streaming to storage (local blob
   *  preview, NOT yet persisted to the doc). Shown with a spinner, no remove. */
  uploading?: boolean;
};

export type CardReferences = Record<string, CardReference[]>;

const ADD_ICON: Record<FizzAiReferenceKind, Icon> = {
  image: IconPhotoPlus,
  video: IconVideoPlus,
  audio: IconMusicPlus,
};

function humanize(field: string) {
  return field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function ReferencePreview({ refItem }: { refItem: CardReference }) {
  const t = useTranslations("canvasNodes");
  if (refItem.kind === "audio") return null;

  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-3 w-[240px] -translate-x-1/2 rounded-2xl border border-white/[0.06] bg-[oklch(0.235_0_0_/_0.95)] p-2 opacity-0 shadow-2xl shadow-black/60 backdrop-blur-2xl transition-opacity duration-150 group-hover:opacity-100">
      <div className="flex max-h-[220px] items-center justify-center overflow-hidden rounded-xl bg-black/35">
        {refItem.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={refItem.url}
            alt={refItem.name ?? t("reference.alt")}
            className="block max-h-[220px] w-full object-contain"
          />
        ) : (
          <video
            src={refItem.url}
            muted
            playsInline
            loop
            autoPlay
            className="block max-h-[220px] w-full object-contain"
          />
        )}
      </div>
      {refItem.name ? (
        <div className="mt-2 truncate px-1 text-xs text-white/75">{refItem.name}</div>
      ) : null}
    </div>
  );
}

/**
 * One reference field's cards (thumbnails + add slot). No section title — the
 * add-card's icon signals the kind; the field name is a hover tooltip. Uses
 * `display: contents` so every card flows into the parent's single row.
 */
function ReferenceField({
  field,
  items,
  onAdd,
  onRemove,
}: {
  field: FizzAiReferenceFieldConstraints;
  items: CardReference[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const AddIcon = ADD_ICON[field.kind];
  const canAdd = items.length < field.maxItems;

  return (
    <div className="contents">
      {items.map((ref) => (
        <div key={ref.id} className="group relative size-16">
          <div className="relative size-16 overflow-hidden rounded-xl bg-white/[0.05]">
            {ref.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ref.url}
                alt={ref.name ?? t("reference.alt")}
                className="size-full object-cover"
              />
            ) : ref.kind === "video" ? (
              <video src={ref.url} muted playsInline className="size-full object-cover" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1 px-1.5 text-center">
                <IconMusic className="size-5 text-white/70" stroke={1.7} />
                <span className="line-clamp-1 text-[9px] text-muted-foreground">
                  {ref.name ?? t("reference.audio")}
                </span>
              </div>
            )}
            {ref.kind === "image" && ref.assetId && !ref.uploading ? (
              <MediaProviderStatusChipForAsset
                mediaAssetId={ref.assetId}
                compact
                className="top-1 left-1 right-auto"
              />
            ) : null}
            {ref.uploading ? (
              // Still uploading to storage — spinner, no remove until it lands.
              <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                <IconLoader2 className="size-5 animate-spin text-white/70" stroke={1.8} />
              </span>
            ) : ref.edgeId ? (
              // Wired in from a source node — remove by disconnecting the wire.
              <span
                title={t("reference.linkedFromNode")}
                className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/55 text-white/80"
              >
                <IconPlugConnected className="size-2.5" stroke={2} />
              </span>
            ) : (
              <button
                type="button"
                aria-label={tc("remove")}
                onClick={() => onRemove(ref.id)}
                className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
              >
                <IconX className="size-3" stroke={2.2} />
              </button>
            )}
          </div>
          <ReferencePreview refItem={ref} />
        </div>
      ))}

      {canAdd && (
        <button
          type="button"
          title={humanize(field.field)}
          aria-label={t("reference.add", { field: humanize(field.field) })}
          onClick={() => inputRef.current?.click()}
          className="flex size-16 items-center justify-center rounded-xl bg-white/[0.05] text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-white"
        >
          <AddIcon className="size-6" stroke={1.6} />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={field.accept}
        multiple={field.maxItems > 1}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onAdd(files.slice(0, Math.max(0, field.maxItems - items.length)));
        }}
      />
    </div>
  );
}

/**
 * Reference uploads shown above the prompt — one labeled group per reference
 * field the model declares (`referenceFields`). Image models surface only
 * images; video models (Seedance) surface start/end frame + reference images,
 * videos, and audios, each with the correct file-picker accept type.
 */
export function ReferenceStack({
  fields,
  references,
  onAdd,
  onRemove,
}: {
  fields: FizzAiReferenceFieldConstraints[];
  references: CardReferences;
  onAdd: (field: string, files: File[]) => void;
  onRemove: (field: string, id: string) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      {fields.map((field) => (
        <ReferenceField
          key={field.field}
          field={field}
          items={references[field.field] ?? []}
          onAdd={(files) => onAdd(field.field, files)}
          onRemove={(id) => onRemove(field.field, id)}
        />
      ))}
    </div>
  );
}
