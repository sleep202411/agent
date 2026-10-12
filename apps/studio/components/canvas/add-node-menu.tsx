"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconCamera,
  IconCloudUpload,
  IconLayoutList,
  IconNote,
  IconPhoto,
  IconSearch,
  IconVideo,
  type Icon,
} from "@tabler/icons-react";
import { IconAudioWaveform } from "@/components/icons/icon-audio-waveform";

/** Product-neutral creation actions shared by every media-authoring canvas. */
export type AddNodeAction =
  | "upload"
  | "generate-image"
  | "generate-video"
  | "generate-audio"
  | "note"
  | "director-desk"
  | "shot";

/** What a canvas offers when the product doesn't narrow it. */
export const DEFAULT_ADD_NODE_ACTIONS: readonly AddNodeAction[] = [
  "upload",
  "generate-image",
  "generate-video",
  "generate-audio",
  "note",
  "director-desk",
];

/** Complete node catalog used by the project canvas and its sidebar panel. */
export const PROJECT_CANVAS_ADD_NODE_ACTIONS: readonly AddNodeAction[] = [
  ...DEFAULT_ADD_NODE_ACTIONS,
  "shot",
];

/** Storyboard projects the canvas's shot nodes as rows, so this is its only creation action. */
export const STORYBOARD_ADD_NODE_ACTIONS: readonly AddNodeAction[] = ["shot"];

/** Creation shortcuts; Shift+V leaves plain V available for the Select tool. */
export const ADD_NODE_SHORTCUTS: Record<AddNodeAction, string> = {
  upload: "u",
  "generate-image": "i",
  "generate-video": "shift+v",
  "generate-audio": "a",
  note: "n",
  "director-desk": "d",
  shot: "s",
};

export const ADD_NODE_ICONS: Record<AddNodeAction, Icon> = {
  upload: IconCloudUpload,
  "generate-image": IconPhoto,
  "generate-video": IconVideo,
  "generate-audio": IconAudioWaveform,
  note: IconNote,
  "director-desk": IconCamera,
  shot: IconLayoutList,
};

/** Translation key under `canvasControls.addNode` / `canvas.dock`. */
export const ADD_NODE_LABEL_KEYS: Record<AddNodeAction, string> = {
  upload: "upload",
  "generate-image": "image",
  "generate-video": "video",
  "generate-audio": "audio",
  note: "note",
  "director-desk": "directorDesk",
  shot: "shot",
};

type MenuItem = { label: string; icon: Icon; shortcut: string; action: AddNodeAction };

export function AddNodeMenu({
  left,
  top,
  state = "open",
  actions = DEFAULT_ADD_NODE_ACTIONS,
  onAction,
  disabledActions,
}: {
  left: number;
  top: number;
  state?: "open" | "closed";
  /** Creation actions this canvas offers, in display order. */
  actions?: readonly AddNodeAction[];
  onAction: (action: AddNodeAction) => void;
  /**
   * Actions that can't accept the dragged source's output type — shown greyed
   * and non-clickable (e.g. a video source disables image generation, since an
   * image model has no video input).
   */
  disabledActions?: ReadonlySet<AddNodeAction>;
}) {
  const t = useTranslations("canvasControls");
  const [query, setQuery] = useState("");

  const ITEMS: MenuItem[] = useMemo(
    () =>
      actions.map((action) => ({
        label: t(`addNode.${ADD_NODE_LABEL_KEYS[action]}`),
        icon: ADD_NODE_ICONS[action],
        shortcut: ADD_NODE_SHORTCUTS[action].toUpperCase(),
        action,
      })),
    [actions, t]
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ITEMS.filter((item) => item.label.toLowerCase().includes(q)) : ITEMS;
  }, [query, ITEMS]);

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
          placeholder={t("addNode.searchPlaceholder")}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="mx-1 h-px bg-border" />

      <div className="p-2">
        {items.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">{t("addNode.noMatches")}</p>
        )}
        {items.map((item) => {
          const ItemIcon = item.icon;
          const disabled = disabledActions?.has(item.action) ?? false;
          return (
            <button
              key={item.action}
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
