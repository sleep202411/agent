"use client";

import { useEffect } from "react";
import {
  IconDeviceTv,
  IconUser,
  IconHome,
  IconMask,
  IconFolder,
  IconWorld,
  IconBulb,
  IconFolders,
  IconMusic,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { DragonIcon } from "@/app/(studio)/art-studio/projects/_components/ai-assistant/dragon-icon";
import { cn } from "@/lib/utils";
import type { WorkspacePanelKey } from "@/src/types/workspace";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { togglePanel, markAssetSeen, selectCurrentInstance } from "@/src/store/slices/projectSlice";

type AssetKey = "episodes" | "world" | "characters" | "scenes" | "props";

type SidebarItem = {
  type: "panel";
  key: WorkspacePanelKey;
  labelKey: string;
  icon: React.ReactNode;
  /** Asset type whose WS version drives this item's red-dot indicator. */
  asset?: AssetKey;
};

const items: SidebarItem[] = [
  {
    type: "panel",
    key: "projects",
    labelKey: "projects",
    icon: <IconFolders className="size-5" />,
  },
  {
    type: "panel",
    key: "episodes",
    labelKey: "episodes",
    icon: <IconDeviceTv className="size-5" />,
    asset: "episodes",
  },
  {
    type: "panel",
    key: "characters",
    labelKey: "characters",
    icon: <IconUser className="size-5" />,
    asset: "characters",
  },
  {
    type: "panel",
    key: "scenes",
    labelKey: "scenes",
    icon: <IconHome className="size-5" />,
    asset: "scenes",
  },
  {
    type: "panel",
    key: "props",
    labelKey: "props",
    icon: <IconMask className="size-5" />,
    asset: "props",
  },
  {
    type: "panel",
    key: "editWorld",
    labelKey: "worldview",
    icon: <IconWorld className="size-5" />,
    asset: "world",
  },
  { type: "panel", key: "myAssets", labelKey: "assets", icon: <IconFolder className="size-5" /> },
  { type: "panel", key: "music", labelKey: "music", icon: <IconMusic className="size-5" /> },
  {
    type: "panel",
    key: "inspiration",
    labelKey: "inspiration",
    icon: <IconBulb className="size-5" />,
  },
];

export function ProjectSidebar() {
  const t = useTranslations("sidebar");
  const dispatch = useAppDispatch();
  const activePanel = useAppSelector((s) => selectCurrentInstance(s).activePanel);

  // Per-asset "unseen" bits (current version > seen version). Kept as
  // separate primitive selectors so we don't return a fresh object each
  // render. Versions come from the WS entity-events stream (see
  // use-entity-events-session.ts) which bumps them on any server change.
  const episodesUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.episodesVersion > inst.episodesSeenVersion;
  });
  const worldUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.worldVersion > inst.worldSeenVersion;
  });
  const charactersUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.charactersVersion > inst.charactersSeenVersion;
  });
  const scenesUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.scenesVersion > inst.scenesSeenVersion;
  });
  const propsUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.propsVersion > inst.propsSeenVersion;
  });
  const unseen: Record<AssetKey, boolean> = {
    episodes: episodesUnseen,
    world: worldUnseen,
    characters: charactersUnseen,
    scenes: scenesUnseen,
    props: propsUnseen,
  };

  // If the user is already on a panel when its asset bumps, auto-mark as
  // seen so the dot doesn't light up while the panel is in view.
  const activeItem = items.find((it) => it.key === activePanel);
  const activeAsset = activeItem?.asset;
  const activeUnseen = activeAsset ? unseen[activeAsset] : false;
  useEffect(() => {
    if (activeAsset && activeUnseen) {
      dispatch(markAssetSeen(activeAsset));
    }
  }, [dispatch, activeAsset, activeUnseen]);

  return (
    <aside className="flex w-auto shrink-0 flex-col pb-3 text-sidebar-foreground">
      <nav data-tour-step="sidebar" className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const isActive = activePanel === item.key;
          const hasUnseen = item.asset ? unseen[item.asset] : false;

          const handleClick = () => {
            dispatch(togglePanel(item.key));
            // Opening the panel (was inactive, now will be active) marks
            // it seen. togglePanel inverts, so only the open-direction
            // should clear the dot.
            if (!isActive && item.asset && hasUnseen) {
              dispatch(markAssetSeen(item.asset));
            }
          };

          return (
            <button
              key={item.key}
              type="button"
              onClick={handleClick}
              className={cn(
                "relative mx-2 flex flex-col items-center gap-1.5 rounded-xl px-2 py-2 transition-colors",
                isActive
                  ? "bg-sidebar-primary/10 text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              <span className="relative">
                {item.icon}
                {hasUnseen && (
                  <span
                    aria-label="unseen changes"
                    className="absolute -right-1 -top-1 size-2 rounded-full bg-[#E63946] ring-2 ring-sidebar"
                  />
                )}
              </span>
              <span className="text-[11px] leading-none">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* AI Assistant — bottom (with dragon animation) */}
      <div className="px-2 pb-3">
        <button
          type="button"
          data-tour-step="ai-assistant"
          onClick={() => dispatch(togglePanel("aiAssistant"))}
          className={cn("group flex w-full flex-col items-center gap-1.5 rounded-xl px-2 py-3")}
        >
          <div
            className={cn(
              "relative size-10 transition-transform duration-300",
              activePanel === "aiAssistant" ? "scale-110" : "group-hover:scale-110"
            )}
          >
            <DragonIcon
              className={cn(
                "relative z-[1] size-full [filter:drop-shadow(0_2px_6px_rgba(229,34,39,0.4))]",
                activePanel === "aiAssistant"
                  ? "animate-[dragon-float_2s_ease-in-out_infinite]"
                  : "group-hover:animate-[dragon-float_2s_ease-in-out_infinite]"
              )}
            />
            <span className="absolute left-1/2 top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFD700] shadow-[0_0_6px_#FFD700] animate-[dragon-orbit_6s_linear_infinite]" />
            <span className="absolute left-1/2 top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFD700] shadow-[0_0_6px_#FFD700] animate-[dragon-orbit_8s_linear_infinite] [animation-delay:-2s]" />
            <span className="absolute left-1/2 top-1/2 size-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFA500] shadow-[0_0_6px_#FFA500] animate-[dragon-orbit_7s_linear_infinite] [animation-delay:-4s]" />
          </div>
          <span
            className={cn(
              "text-[11px] leading-none transition-colors",
              activePanel === "aiAssistant"
                ? "text-primary"
                : "text-sidebar-foreground/70 group-hover:text-[#E63946]"
            )}
          >
            {t("aiAssistant")}
          </span>
        </button>
      </div>
    </aside>
  );
}
