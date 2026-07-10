"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { IconAlertTriangle, IconMusic, IconPlus, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { FizzAiReferenceFieldConstraints } from "@/app/[locale]/canvas/_lib/generation-api";
import { ReferenceMediaHoverPreview, mediaHoverPreviewPosition } from "@/lib/prompt-mentions";
import type { ReferenceUpload } from "./use-reference-uploads";

const COMPACT_TILT = [-8, 4, -3, 6];
const EXPANDED_TILT = [-6, -2, 2, 6];
const MAX_VISIBLE = 4;

function fieldTitle(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function TileMedia({ item }: { item: ReferenceUpload }) {
  if (item.error) {
    return (
      <span className="flex size-full items-center justify-center bg-destructive/20">
        <IconAlertTriangle className="size-4 text-destructive" stroke={1.8} />
      </span>
    );
  }
  if (item.kind === "audio") {
    return (
      <span className="flex size-full items-center justify-center bg-muted">
        <IconMusic className="size-4 text-white/70" stroke={1.7} />
      </span>
    );
  }
  if (item.kind === "video") {
    return <video src={item.previewUrl} muted playsInline className="size-full object-cover" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={item.previewUrl} alt={item.name} className="size-full object-cover" />;
}

function ReferenceFanTile({
  expanded,
  index,
  item,
  onRemove,
  overflow,
  step,
  visibleLength,
}: {
  expanded: boolean;
  index: number;
  item: ReferenceUpload;
  onRemove: (id: string) => void;
  overflow: number;
  step: number;
  visibleLength: number;
}) {
  const t = useTranslations("generation");
  const tileRef = useRef<HTMLDivElement>(null);
  const [previewStyle, setPreviewStyle] = useState<CSSProperties | null>(null);
  const showPreview = () => {
    const rect = tileRef.current?.getBoundingClientRect();
    if (rect) setPreviewStyle(mediaHoverPreviewPosition(rect, item.kind));
  };

  return (
    <div
      ref={tileRef}
      className="group absolute top-1 h-[68px] w-[52px] transition-all duration-200 hover:z-30 hover:-translate-y-1 hover:rotate-0"
      style={{
        left: index * step,
        transform: `rotate(${(expanded ? EXPANDED_TILT : COMPACT_TILT)[index % 4]}deg)`,
        zIndex: index,
      }}
      title={item.error ?? item.name}
      onPointerEnter={showPreview}
      onPointerMove={showPreview}
      onPointerLeave={() => setPreviewStyle(null)}
      onMouseEnter={showPreview}
      onMouseMove={showPreview}
      onMouseLeave={() => setPreviewStyle(null)}
    >
      <div className="relative size-full overflow-hidden rounded-lg bg-muted shadow-md shadow-black/40">
        <TileMedia item={item} />
        {item.uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-medium text-white tabular-nums">
            {item.progress}%
          </span>
        )}
        {!item.uploading && (
          <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[8px] font-medium text-white/90">
            @{item.label}
          </span>
        )}
        {overflow > 0 && index === visibleLength - 1 && (
          <span className="pointer-events-none absolute top-0.5 right-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            +{overflow}
          </span>
        )}
        <button
          type="button"
          aria-label={t("removeReference", { label: item.label })}
          onClick={() => onRemove(item.id)}
          className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          <IconX className="size-2.5" stroke={2.4} />
        </button>
      </div>
      {!item.error && previewStyle ? (
        <ReferenceMediaHoverPreview
          item={{
            kind: item.kind,
            label: item.label,
            name: item.name,
            previewUrl: item.previewUrl,
          }}
          style={previewStyle}
        />
      ) : null}
    </div>
  );
}

/**
 * Fanned reference stack (imagine.art pattern): tilted 54×72 cards overlapped
 * at the prompt's left; hovering expands the fan and reveals per-card remove.
 * The trailing "+" tile adds files — when the active mode takes several
 * reference kinds it opens a per-field menu with counts; with one field it
 * opens the picker directly.
 */
export function ReferenceFan({
  fields,
  items,
  onAdd,
  onRemove,
}: {
  fields: FizzAiReferenceFieldConstraints[];
  items: ReferenceUpload[];
  onAdd: (field: FizzAiReferenceFieldConstraints, files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("generation");
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - visible.length;
  const step = expanded ? 46 : 26;

  const fieldCount = (field: string) => items.filter((item) => item.field === field).length;
  const fieldFull = (f: FizzAiReferenceFieldConstraints) => fieldCount(f.field) >= f.maxItems;
  const anyRoom = fields.some((f) => !fieldFull(f));

  const openPicker = (f: FizzAiReferenceFieldConstraints) => {
    setMenuOpen(false);
    inputRefs.current.get(f.field)?.click();
  };

  const onAddClick = () => {
    if (fields.length === 1) {
      openPicker(fields[0]);
      return;
    }
    setMenuOpen((open) => !open);
  };

  return (
    <div
      className="relative h-[76px] select-none"
      style={{ width: step * Math.max(visible.length, 0) + 64 }}
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={() => {
        setExpanded(false);
        setMenuOpen(false);
      }}
      data-popover-zone
    >
      {/* Hidden pickers — one per schema field, with that field's accept. */}
      {fields.map((f) => (
        <input
          key={f.field}
          ref={(el) => {
            if (el) inputRefs.current.set(f.field, el);
            else inputRefs.current.delete(f.field);
          }}
          type="file"
          accept={f.accept}
          multiple={f.maxItems > 1}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!files.length) return;
            const room = f.maxItems - fieldCount(f.field);
            onAdd(f, files.slice(0, Math.max(0, room)));
          }}
        />
      ))}

      {visible.map((item, index) => (
        <ReferenceFanTile
          key={item.id}
          expanded={expanded}
          index={index}
          item={item}
          onRemove={onRemove}
          overflow={overflow}
          step={step}
          visibleLength={visible.length}
        />
      ))}

      {anyRoom && (
        <button
          type="button"
          aria-label={t("addReference")}
          onClick={onAddClick}
          className={cn(
            "absolute top-1 flex h-[68px] w-[52px] items-center justify-center rounded-lg bg-white/[0.06] text-white/55 shadow-md shadow-black/30 transition-all duration-200 hover:bg-white/[0.1] hover:text-white",
            visible.length === 0 ? "rotate-[-5deg]" : "rotate-[5deg]"
          )}
          style={{ left: visible.length * step }}
        >
          <IconPlus className="size-4.5" stroke={1.8} />
        </button>
      )}

      {/* Per-kind add menu (multi-field modes). */}
      {menuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-60 rounded-2xl bg-[oklch(0.24_0_0)] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95">
          {fields.map((f) => {
            const full = fieldFull(f);
            return (
              <button
                key={f.field}
                type="button"
                disabled={full}
                onClick={() => openPicker(f)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>{fieldTitle(f.field)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {fieldCount(f.field)}/{f.maxItems}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
