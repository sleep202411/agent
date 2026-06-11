"use client";

import { useMemo, useState } from "react";
import {
  IconAspectRatio,
  IconArrowsDiagonal,
  IconBulb,
  IconCamera,
  IconChevronRight,
  IconCloudUpload,
  IconLayoutColumns,
  IconLayoutGrid,
  IconMicrophone,
  IconPhoto,
  IconPhotoEdit,
  IconScissors,
  IconSearch,
  IconSparkles,
  IconTools,
  IconTypography,
  IconVideo,
  IconWand,
  type Icon,
} from "@tabler/icons-react";
import { toast } from "sonner";

export type AddNodeAction = "upload" | "generate-image" | "generate-video" | "text-prompt";

/** The data type a dragged-from port carries; gates which menu items show. */
export type ConnectFilter = "image" | "text" | "video";

type MenuItem = {
  label: string;
  icon: Icon;
  shortcut?: string;
  badge?: string;
  submenu?: boolean;
  action?: AddNodeAction;
  /** Input types this node can consume. Used to filter when continuing a wire. */
  accepts?: ConnectFilter[];
};

type MenuSection = { title: string; items: MenuItem[] };

const SECTIONS: MenuSection[] = [
  {
    title: "Add",
    items: [
      { label: "Upload", icon: IconCloudUpload, shortcut: "U", action: "upload" },
      {
        label: "Image",
        icon: IconPhoto,
        shortcut: "I",
        action: "generate-image",
        accepts: ["text", "image"],
      },
      {
        label: "Video",
        icon: IconVideo,
        shortcut: "V",
        action: "generate-video",
        accepts: ["text", "image"],
      },
      { label: "Voice", icon: IconMicrophone, shortcut: "A", accepts: ["text"] },
      { label: "Copilot", icon: IconSparkles, shortcut: "C", accepts: ["text", "image"] },
      { label: "Prompt", icon: IconTypography, shortcut: "T / P", action: "text-prompt" },
    ],
  },
  {
    title: "Image",
    items: [
      {
        label: "Generate Image",
        icon: IconPhoto,
        submenu: true,
        action: "generate-image",
        accepts: ["text", "image"],
      },
      { label: "Edit Image", icon: IconPhotoEdit, submenu: true, accepts: ["image"] },
      { label: "Upscale Image", icon: IconArrowsDiagonal, submenu: true, accepts: ["image"] },
      { label: "Generative Fill", icon: IconWand, badge: "New", accepts: ["image"] },
      { label: "Multiple Camera Angles", icon: IconCamera, accepts: ["image"] },
      { label: "Relight", icon: IconBulb, accepts: ["image"] },
      { label: "Storyboard", icon: IconLayoutGrid, badge: "New", accepts: ["text", "image"] },
      { label: "AI Resize", icon: IconAspectRatio, accepts: ["image"] },
      { label: "Split Image", icon: IconLayoutColumns, accepts: ["image"] },
      { label: "Image Utilities", icon: IconTools, submenu: true, accepts: ["image"] },
    ],
  },
  {
    title: "Video",
    items: [
      {
        label: "Generate Video",
        icon: IconVideo,
        action: "generate-video",
        accepts: ["text", "image"],
      },
      { label: "Edit Video", icon: IconScissors, submenu: true, accepts: ["video"] },
      { label: "Extend Video", icon: IconArrowsDiagonal, accepts: ["video"] },
    ],
  },
];

export function AddNodeMenu({
  left,
  top,
  filter,
  onAction,
}: {
  left: number;
  top: number;
  /** When the menu was opened by dragging a wire, only nodes that accept that
   *  port's type are shown (imagine.art behavior). */
  filter?: ConnectFilter;
  onAction: (action: AddNodeAction) => void;
}) {
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (filter && !item.accepts?.includes(filter)) return false;
        if (q && !item.label.toLowerCase().includes(q)) return false;
        return true;
      }),
    })).filter((section) => section.items.length > 0);
  }, [query, filter]);

  const onSelect = (item: MenuItem) => {
    if (item.action) {
      onAction(item.action);
      return;
    }
    toast.info(`${item.label} · Coming soon`);
  };

  return (
    <div
      className="absolute z-30 flex w-[372px] flex-col rounded-2xl bg-popover/95 shadow-xl backdrop-blur-xl"
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
          placeholder="Search nodes or models"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="mx-1 h-px bg-border" />

      <div className="max-h-[440px] overflow-y-auto p-2">
        {sections.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No matching nodes</p>
        )}
        {sections.map((section) => (
          <div key={section.title} className="pb-1">
            <div className="px-2 pt-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
              {section.title}
            </div>
            {section.items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                    <ItemIcon className="size-4.5 text-white/80" stroke={1.7} />
                  </span>
                  <span className="flex-1 truncate text-sm">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-white/80">
                      {item.badge}
                    </span>
                  )}
                  {item.shortcut && (
                    <span className="text-xs text-muted-foreground">{item.shortcut}</span>
                  )}
                  {item.submenu && (
                    <IconChevronRight className="size-4 text-muted-foreground" stroke={1.8} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
