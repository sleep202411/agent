"use client";

import type { ReactElement } from "react";
import { useTranslations } from "next-intl";
import { useReactFlow, useViewport, type FitViewOptions } from "@xyflow/react";
import {
  IconApps,
  IconCloudUpload,
  IconLayoutList,
  IconMagnet,
  IconMap,
  IconMaximize,
  IconMinus,
  IconNote,
  IconPhoto,
  IconPlus,
  IconVideo,
  type Icon,
} from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CanvasToolButtons } from "./canvas-controls";
import { ADD_NODE_LABEL_KEYS, DEFAULT_ADD_NODE_ACTIONS, type AddNodeAction } from "./add-node-menu";
import { cn } from "@/lib/utils";

export const CANVAS_FLOATING_PANEL =
  "bg-[oklch(0.205_0_0)]/95 shadow-lg shadow-black/40 backdrop-blur-xl";

function ControlTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function CanvasAuthoringControls({
  onTidy,
  snapToGrid,
  onToggleSnap,
  minimapOpen,
  onToggleMinimap,
  leftInset = 0,
  fitViewPadding = 0.3,
}: {
  onTidy: () => void;
  snapToGrid: boolean;
  onToggleSnap: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  leftInset?: number;
  fitViewPadding?: FitViewOptions["padding"];
}) {
  const t = useTranslations("canvas");
  const { zoom } = useViewport();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const controlClass =
    "flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white";
  const toggleClass = (active: boolean) => cn(controlClass, active && "bg-white/[0.12] text-white");
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      className="nodrag nopan nowheel absolute bottom-4 z-20 flex h-[42px] items-center gap-0.5 rounded-full bg-popover/90 px-2 shadow-md backdrop-blur-xl transition-[left] duration-200 ease-out"
      style={{
        left: `calc(var(--project-canvas-left-overlay-inset, 0px) + ${16 + leftInset}px)`,
      }}
    >
      <CanvasToolButtons
        buttonClassName={controlClass}
        activeButtonClassName="bg-white/[0.12] text-white"
        renderTooltip={(label, button) => <ControlTooltip label={label}>{button}</ControlTooltip>}
      />
      <span className="mx-0.5 h-4 w-px bg-white/10" />
      <ControlTooltip label={t("tidyCanvas")}>
        <button
          type="button"
          aria-label={t("tidyCanvas")}
          className={controlClass}
          onClick={() => onTidy()}
        >
          <IconApps className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("toggleMinimap")}>
        <button
          type="button"
          aria-label={t("toggleMinimap")}
          aria-pressed={minimapOpen}
          className={toggleClass(minimapOpen)}
          onClick={onToggleMinimap}
        >
          <IconMap className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("snapToGrid")}>
        <button
          type="button"
          aria-label={t("snapToGrid")}
          aria-pressed={snapToGrid}
          className={toggleClass(snapToGrid)}
          onClick={onToggleSnap}
        >
          <IconMagnet className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <span className="mx-0.5 h-4 w-px bg-white/10" />
      <ControlTooltip label={t("zoomOut")}>
        <button
          type="button"
          aria-label={t("zoomOut")}
          className={controlClass}
          onClick={() => zoomOut()}
        >
          <IconMinus className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("zoomLevel", { percent: zoomPercent })}>
        <span className="w-12 text-center text-xs text-white/70 tabular-nums select-none">
          {zoomPercent}%
        </span>
      </ControlTooltip>
      <ControlTooltip label={t("zoomIn")}>
        <button
          type="button"
          aria-label={t("zoomIn")}
          className={controlClass}
          onClick={() => zoomIn()}
        >
          <IconPlus className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
      <ControlTooltip label={t("zoomToFit")}>
        <button
          type="button"
          aria-label={t("zoomToFit")}
          className={controlClass}
          onClick={() => fitView({ padding: fitViewPadding, duration: 300 })}
        >
          <IconMaximize className="size-4" stroke={1.8} />
        </button>
      </ControlTooltip>
    </div>
  );
}

const DOCK_ICONS: Record<AddNodeAction, Icon> = {
  upload: IconCloudUpload,
  "generate-image": IconPhoto,
  "generate-video": IconVideo,
  note: IconNote,
  shot: IconLayoutList,
};

export function CanvasAuthoringDock({
  actions = DEFAULT_ADD_NODE_ACTIONS,
  onAdd,
}: {
  actions?: readonly AddNodeAction[];
  onAdd: (action: AddNodeAction) => void;
}) {
  const t = useTranslations("canvas");
  return (
    <div
      className={cn(
        "absolute bottom-5 left-1/2 z-20 flex h-[48px] -translate-x-1/2 items-center gap-1 rounded-2xl px-2.5",
        CANVAS_FLOATING_PANEL
      )}
    >
      {actions.map((action) => {
        const Icon = DOCK_ICONS[action];
        const label = t(`dock.${ADD_NODE_LABEL_KEYS[action]}`);
        return (
          <button
            key={action}
            type="button"
            aria-label={label}
            onClick={() => onAdd(action)}
            className="group relative flex size-10 items-center justify-center rounded-full text-white/72 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <Icon className="size-5" stroke={1.7} />
            <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-md transition-opacity group-hover:opacity-100">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
