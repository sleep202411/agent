"use client";

import { useMemo, useState } from "react";
import {
  IconCloudUpload,
  IconNote,
  IconPhoto,
  IconSearch,
  IconVideo,
  type Icon,
} from "@tabler/icons-react";

export type AddNodeAction = "upload" | "generate-image" | "generate-video" | "note";

type MenuItem = { label: string; icon: Icon; shortcut: string; action: AddNodeAction };

// Only the node types the studio actually supports today.
const ITEMS: MenuItem[] = [
  { label: "Upload", icon: IconCloudUpload, shortcut: "U", action: "upload" },
  { label: "Image", icon: IconPhoto, shortcut: "I", action: "generate-image" },
  { label: "Video", icon: IconVideo, shortcut: "V", action: "generate-video" },
  { label: "Note", icon: IconNote, shortcut: "N", action: "note" },
];

export function AddNodeMenu({
  left,
  top,
  state = "open",
  onAction,
  disabledActions,
}: {
  left: number;
  top: number;
  state?: "open" | "closed";
  onAction: (action: AddNodeAction) => void;
  /**
   * Actions that can't accept the dragged source's output type — shown greyed
   * and non-clickable (e.g. a video source disables image generation, since an
   * image model has no video input).
   */
  disabledActions?: ReadonlySet<AddNodeAction>;
}) {
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ITEMS.filter((item) => item.label.toLowerCase().includes(q)) : ITEMS;
  }, [query]);

  return (
    <div
      data-state={state}
      className="absolute z-30 flex w-[300px] origin-top flex-col rounded-2xl bg-popover/95 shadow-xl backdrop-blur-xl duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
      style={{ left, top }}
      // Double-clicking inside the menu must not re-trigger the canvas handler.
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3">
        <IconSearch className="size-4.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search nodes"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="mx-1 h-px bg-border" />

      <div className="p-2">
        {items.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No matching nodes</p>
        )}
        {items.map((item) => {
          const ItemIcon = item.icon;
          const disabled = disabledActions?.has(item.action) ?? false;
          return (
            <button
              key={item.label}
              type="button"
              disabled={disabled}
              onClick={disabled ? undefined : () => onAction(item.action)}
              className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${
                disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white/[0.06]"
              }`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                <ItemIcon className="size-4.5 text-white/80" stroke={1.7} />
              </span>
              <span className="flex-1 truncate text-sm">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.shortcut}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
