"use client";

import { useRef } from "react";
import {
  IconMusic,
  IconMusicPlus,
  IconPhotoPlus,
  IconVideoPlus,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import type {
  FizzAiReferenceFieldConstraints,
  FizzAiReferenceKind,
} from "@/app/canvas/_lib/generation-api";

export type CardReference = {
  id: string;
  url: string;
  name?: string;
  kind: FizzAiReferenceKind;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const AddIcon = ADD_ICON[field.kind];
  const canAdd = items.length < field.maxItems;

  return (
    <div className="contents">
      {items.map((ref) => (
        <div
          key={ref.id}
          className="group relative size-16 overflow-hidden rounded-xl bg-white/[0.05]"
        >
          {ref.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ref.url} alt={ref.name ?? "Reference"} className="size-full object-cover" />
          ) : ref.kind === "video" ? (
            <video src={ref.url} muted playsInline className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1 px-1.5 text-center">
              <IconMusic className="size-5 text-white/70" stroke={1.7} />
              <span className="line-clamp-1 text-[9px] text-muted-foreground">
                {ref.name ?? "Audio"}
              </span>
            </div>
          )}
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onRemove(ref.id)}
            className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          >
            <IconX className="size-3" stroke={2.2} />
          </button>
        </div>
      ))}

      {canAdd && (
        <button
          type="button"
          title={humanize(field.field)}
          aria-label={`Add ${humanize(field.field)}`}
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
 * Local preview for now; SAS upload + persistence wire with generation.
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
