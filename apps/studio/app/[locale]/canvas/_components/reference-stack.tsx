"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  IconLoader2,
  IconMusic,
  IconMusicPlus,
  IconPhotoPlus,
  IconPlugConnected,
  IconUser,
  IconUserPlus,
  IconVideoPlus,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import type {
  FizzAiReferenceFieldConstraints,
  FizzAiReferenceKind,
} from "@/app/[locale]/canvas/_lib/generation-api";

/**
 * Pseudo reference slot holding a card's cast characters. NOT a model schema
 * field: character refs never enter `input[field]` (they ride the submit as
 * `referenceBindings` with `role: 'character'`, and the server expands the
 * character's library media). Kept inside `references` so copy/paste, edge
 * cleanup, and the composer all see one reference bag.
 */
export const CHARACTER_REFS_FIELD = "characterRefs";

export type CardReference = {
  id: string;
  url: string;
  name?: string;
  /** `character` is a client-side pseudo-kind (see CHARACTER_REFS_FIELD). */
  kind: FizzAiReferenceKind | "character";
  /** Present when the reference came from a wired source node (vs an upload). */
  edgeId?: string;
  sourceNodeId?: string;
  /** Present on `kind: 'character'` refs — the StudioCharacter id. */
  characterId?: string;
  /** Present on `kind: 'character'` refs — the character name (prompt `@` token). */
  label?: string;
  /** Transient: an uploaded reference still streaming to storage (local blob
   *  preview, NOT yet persisted to the doc). Shown with a spinner, no remove. */
  uploading?: boolean;
};

export type CardReferences = Record<string, CardReference[]>;

/** A resolved character chip (cover already mapped from the project cast). */
export type CharacterChipItem = {
  /** The CardReference id (remove handle), not the character id. */
  id: string;
  label: string;
  coverUrl?: string;
};

/** Character pseudo-slot wiring the composer passes down (data + picker owned
 *  by the generation card; this component only renders chips + the add slot). */
export type CharacterSlot = {
  items: CharacterChipItem[];
  canAdd: boolean;
  /** Whether the cast picker popover is open (anchored to the add slot). */
  open: boolean;
  /** The `<CastPicker />` element, rendered inside the anchored popover zone. */
  picker: ReactNode;
  onToggle: () => void;
  onRemove: (refId: string) => void;
};

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
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
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
 * Cast-character chips + the "add character" slot. Chips are visually distinct
 * from plain image thumbs: cover (or a person glyph) with a person-badged name
 * strip. The picker popover itself is owned by the generation card (it needs
 * project/workspace data); this only anchors it.
 */
function CharacterField({ items, canAdd, open, picker, onToggle, onRemove }: CharacterSlot) {
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
  return (
    <div className="contents">
      {items.map((chip) => (
        <div
          key={chip.id}
          title={chip.label}
          className="group relative size-16 overflow-hidden rounded-xl bg-white/[0.05]"
        >
          {chip.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={chip.coverUrl} alt={chip.label} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <IconUser className="size-6 text-white/60" stroke={1.6} />
            </div>
          )}
          {/* Person-badged name strip — marks the chip as a character. */}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-3 pb-1">
            <IconUser className="size-2.5 shrink-0 text-white/80" stroke={2} />
            <span className="line-clamp-1 text-[9px] font-medium text-white/90">{chip.label}</span>
          </span>
          <button
            type="button"
            aria-label={tc("remove")}
            onClick={() => onRemove(chip.id)}
            className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
          >
            <IconX className="size-3" stroke={2.2} />
          </button>
        </div>
      ))}

      {canAdd && (
        <div className="relative" data-popover-zone>
          <button
            type="button"
            title="Character"
            aria-label={t("reference.add", { field: "Character" })}
            onClick={onToggle}
            className="flex size-16 items-center justify-center rounded-xl bg-white/[0.05] text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-white"
          >
            <IconUserPlus className="size-6" stroke={1.6} />
          </button>
          {open && picker}
        </div>
      )}
    </div>
  );
}

/**
 * Reference uploads shown above the prompt — one labeled group per reference
 * field the model declares (`referenceFields`), plus the character pseudo-slot
 * when the model accepts reference images. Image models surface only images;
 * video models (Seedance) surface start/end frame + reference images, videos,
 * and audios, each with the correct file-picker accept type.
 * Local preview for now; SAS upload + persistence wire with generation.
 */
export function ReferenceStack({
  fields,
  references,
  onAdd,
  onRemove,
  characters,
}: {
  fields: FizzAiReferenceFieldConstraints[];
  references: CardReferences;
  onAdd: (field: string, files: File[]) => void;
  onRemove: (field: string, id: string) => void;
  characters?: CharacterSlot;
}) {
  if (fields.length === 0 && !characters) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      {characters && <CharacterField {...characters} />}
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
