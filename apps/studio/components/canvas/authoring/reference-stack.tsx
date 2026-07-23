"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import {
  IconLoader2,
  IconMusic,
  IconMusicPlus,
  IconPhotoPlus,
  IconVideoPlus,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import type {
  FizzAiReferenceFieldConstraints,
  FizzAiReferenceKind,
} from "@/lib/canvas-authoring/generation-api";
import { MediaAssetReadinessChipForAsset } from "./media-asset-readiness";
import { ReferenceMediaHoverPreview, mediaHoverPreviewPosition } from "@/lib/prompt-mentions";

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

function ReferenceTile({
  refItem,
  onRemove,
}: {
  refItem: CardReference;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
  const tileRef = useRef<HTMLDivElement>(null);
  const [previewStyle, setPreviewStyle] = useState<CSSProperties | null>(null);
  const showPreview = () => {
    const rect = tileRef.current?.getBoundingClientRect();
    if (rect) setPreviewStyle(mediaHoverPreviewPosition(rect, refItem.kind));
  };

  return (
    <div
      ref={tileRef}
      data-reference-edge-id={refItem.edgeId}
      data-reference-kind={refItem.kind}
      data-reference-tile=""
      title={refItem.name}
      className="group relative size-16 shrink-0"
      onPointerEnter={showPreview}
      onPointerMove={showPreview}
      onPointerLeave={() => setPreviewStyle(null)}
      onMouseEnter={showPreview}
      onMouseMove={showPreview}
      onMouseLeave={() => setPreviewStyle(null)}
    >
      <div className="relative size-16 overflow-hidden rounded-xl bg-white/[0.05]">
        {refItem.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={refItem.url}
            alt={refItem.name ?? t("reference.alt")}
            className="size-full object-cover"
          />
        ) : refItem.kind === "video" ? (
          <video src={refItem.url} muted playsInline className="size-full object-cover" />
        ) : (
          <div className="flex size-full min-w-0 flex-col items-center justify-center gap-1 bg-violet-500/20 px-2 text-center transition-colors group-hover:bg-violet-500/30">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-violet-200/10 text-violet-100">
              <IconMusic className="size-4" stroke={1.8} />
            </span>
            <span className="w-full truncate text-[9px] leading-none font-medium text-violet-100/70">
              {refItem.name ?? t("reference.audio")}
            </span>
          </div>
        )}
        {(refItem.kind === "image" || refItem.kind === "video") &&
        refItem.assetId &&
        !refItem.uploading ? (
          <MediaAssetReadinessChipForAsset
            mediaAssetId={refItem.assetId}
            capability={MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference}
            compact
            className="top-1 left-1 right-auto"
          />
        ) : null}
        {refItem.uploading ? (
          // Still uploading to storage — spinner, no remove until it lands.
          <span className="absolute inset-0 flex items-center justify-center bg-black/45">
            <IconLoader2 className="size-5 animate-spin text-white/70" stroke={1.8} />
          </span>
        ) : (
          <button
            type="button"
            aria-label={tc("remove")}
            onClick={() => onRemove(refItem.id)}
            className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          >
            <IconX className="size-3" stroke={2.2} />
          </button>
        )}
      </div>
      {previewStyle ? (
        <ReferenceMediaHoverPreview
          item={{
            kind: refItem.kind,
            label: refItem.name ?? refItem.id,
            name: refItem.name,
            previewUrl: refItem.url,
          }}
          style={previewStyle}
        />
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
  const inputRef = useRef<HTMLInputElement>(null);
  const AddIcon = ADD_ICON[field.kind];
  const canAdd = items.length < field.maxItems;

  return (
    <div className="contents">
      {items.map((ref) => (
        <ReferenceTile key={ref.id} refItem={ref} onRemove={onRemove} />
      ))}

      {canAdd && (
        <button
          type="button"
          title={humanize(field.field)}
          aria-label={t("reference.add", { field: humanize(field.field) })}
          onClick={() => inputRef.current?.click()}
          className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-white"
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
    <div
      data-canvas-scroll-owner="x"
      className="nowheel flex items-center gap-2 overflow-x-auto overflow-y-visible pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
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
