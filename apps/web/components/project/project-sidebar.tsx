"use client";

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
import { DragonIcon } from "@/components/project/ai-assistant/dragon-icon";
import { cn } from "@/lib/utils";
import type { WorkspacePanelKey } from "@/src/types/workspace";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { togglePanel, selectCurrentInstance } from "@/src/store/slices/projectSlice";

type SidebarItem = {
  type: "panel";
  key: WorkspacePanelKey;
  labelKey: string;
  icon: React.ReactNode;
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
  },
  {
    type: "panel",
    key: "characters",
    labelKey: "characters",
    icon: <IconUser className="size-5" />,
  },
  { type: "panel", key: "scenes", labelKey: "scenes", icon: <IconHome className="size-5" /> },
  { type: "panel", key: "props", labelKey: "props", icon: <IconMask className="size-5" /> },
  {
    type: "panel",
    key: "editWorld",
    labelKey: "worldview",
    icon: <IconWorld className="size-5" />,
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

  return (
    <aside className="flex w-auto shrink-0 flex-col pb-3 text-sidebar-foreground">
      <nav data-tour-step="sidebar" className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const isActive = activePanel === item.key;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => dispatch(togglePanel(item.key))}
              className={cn(
                "mx-2 flex flex-col items-center gap-1.5 rounded-xl px-2 py-2 transition-colors",
                isActive
                  ? "bg-sidebar-primary/10 text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              )}
            >
              {item.icon}
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
