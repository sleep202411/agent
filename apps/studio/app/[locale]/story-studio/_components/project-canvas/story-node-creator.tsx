"use client";

import { useEffect, useRef } from "react";
import { IconMovie, IconRoute, IconSparkles, IconWorld, type Icon } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDismiss } from "@/lib/use-dismiss";
import type { StoryNodeCreationKind } from "./story-node-creator-model";

export type { StoryNodeCreationKind } from "./story-node-creator-model";

interface StoryNodeCreatorProps {
  position: { left: number; top: number };
  showStoryWorld: boolean;
  onCreate: (kind: StoryNodeCreationKind) => void;
  onCancel: () => void;
}

interface CreatorItem {
  kind: StoryNodeCreationKind;
  icon: Icon;
  color: string;
  iconBackground: string;
}

const CREATOR_ITEMS: CreatorItem[] = [
  {
    kind: "root",
    icon: IconWorld,
    color: "rgba(255,255,255,0.10)",
    iconBackground: "rgba(255,255,255,0.18)",
  },
  {
    kind: "clip",
    icon: IconMovie,
    color: "rgba(255,255,255,0.14)",
    iconBackground: "rgba(255,255,255,0.22)",
  },
  {
    kind: "router",
    icon: IconRoute,
    color: "rgba(224,164,92,0.30)",
    iconBackground: "rgba(224,164,92,0.54)",
  },
  {
    kind: "ending",
    icon: IconSparkles,
    color: "rgba(229,34,39,0.36)",
    iconBackground: "rgba(229,34,39,0.60)",
  },
];

function visibleCreatorItems(showStoryWorld: boolean): CreatorItem[] {
  return showStoryWorld ? CREATOR_ITEMS : CREATOR_ITEMS.filter((item) => item.kind !== "root");
}

export function StoryNodeDock({
  showStoryWorld,
  onCreate,
}: {
  showStoryWorld: boolean;
  onCreate: (kind: StoryNodeCreationKind) => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const creatorItems = visibleCreatorItems(showStoryWorld);

  return (
    <FrostedPanel
      role="toolbar"
      aria-label={t("addNode")}
      className="absolute bottom-5 left-1/2 z-40 flex h-12 -translate-x-1/2 items-center gap-1 rounded-[18px] bg-[oklch(0.24_0_0/0.86)] px-2 shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-[30px] backdrop-saturate-150"
    >
      {creatorItems.map((item) => {
        const ItemIcon = item.icon;
        const label = t(`creator.${item.kind}`);
        return (
          <Tooltip key={item.kind}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onCreate(item.kind)}
                className="grid size-10 place-items-center rounded-[14px] text-white/64 transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
                aria-label={label}
              >
                <ItemIcon className="size-5" stroke={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </FrostedPanel>
  );
}

export function StoryNodeCreator({
  position,
  showStoryWorld,
  onCreate,
  onCancel,
}: StoryNodeCreatorProps) {
  const t = useTranslations("storyStudio.canvas");
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const creatorItems = visibleCreatorItems(showStoryWorld);

  useDismiss(true, onCancel);
  useEffect(() => firstActionRef.current?.focus(), []);

  return (
    <FrostedPanel
      data-popover-zone
      role="menu"
      aria-label={t("creator.title")}
      className="absolute z-50 w-[310px] rounded-[22px] bg-[oklch(0.24_0_0/0.96)] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.58)] backdrop-blur-[40px]"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="px-3 pt-2 pb-2.5">
        <p className="text-xs font-semibold text-white/86">{t("creator.title")}</p>
        <p className="mt-1 text-[10px] leading-4 text-white/38">{t("creator.description")}</p>
      </div>
      <div className="grid gap-1">
        {creatorItems.map((item, index) => {
          const ItemIcon = item.icon;
          return (
            <button
              ref={index === 0 ? firstActionRef : undefined}
              key={item.kind}
              type="button"
              role="menuitem"
              onClick={() => onCreate(item.kind)}
              className="group flex min-h-16 w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              <span
                className="grid size-10 shrink-0 place-items-center rounded-[14px] text-white shadow-[0_10px_26px_rgba(0,0,0,0.22)]"
                style={{ backgroundColor: item.color }}
              >
                <span
                  className="grid size-7 place-items-center rounded-[10px]"
                  style={{ backgroundColor: item.iconBackground }}
                >
                  <ItemIcon className="size-4" stroke={2} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-white/80 group-hover:text-white">
                  {t(`creator.${item.kind}`)}
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-white/36">
                  {t(`creator.${item.kind}Description`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </FrostedPanel>
  );
}
