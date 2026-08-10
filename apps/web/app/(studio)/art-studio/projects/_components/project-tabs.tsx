"use client";

import { useEffect } from "react";
import { IconFileText, IconLayoutGrid, IconClock } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { markAssetSeen, selectCurrentInstance } from "@/src/store/slices/projectSlice";

export type ProjectTab = "script" | "storyboard" | "timeline";

// `asset` ties a tab to the per-instance unseen-version pair driven by
// the entity-events stream. Tabs without an asset never show a dot
// (Timeline currently has no dedicated entity-event channel — its
// content is a derived view over storyboard + audio).
type TabAsset = "script" | "storyboard";

const tabs: {
  key: ProjectTab;
  labelKey: string;
  icon: React.ReactNode;
  asset?: TabAsset;
}[] = [
  { key: "script", labelKey: "script", icon: <IconFileText className="size-4" />, asset: "script" },
  {
    key: "storyboard",
    labelKey: "storyboard",
    icon: <IconLayoutGrid className="size-4" />,
    asset: "storyboard",
  },
  { key: "timeline", labelKey: "timeline", icon: <IconClock className="size-4" /> },
];

interface ProjectTabsProps {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}

export function ProjectTabs({ activeTab, onTabChange }: ProjectTabsProps) {
  const t = useTranslations("tabs");
  const dispatch = useAppDispatch();

  // Per-tab unseen flags (live > seen). Selectors are kept primitive so
  // we don't rebuild a fresh object every render.
  const scriptUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.scriptVersion > inst.scriptSeenVersion;
  });
  const storyboardUnseen = useAppSelector((s) => {
    const inst = selectCurrentInstance(s);
    return inst.storyboardVersion > inst.storyboardSeenVersion;
  });
  const unseen: Record<TabAsset, boolean> = {
    script: scriptUnseen,
    storyboard: storyboardUnseen,
  };

  // If the user is already on a tab when its asset bumps, auto-mark as
  // seen so the dot doesn't light up while the tab is in view. Mirrors
  // the sidebar's pattern.
  const activeAsset = tabs.find((t) => t.key === activeTab)?.asset;
  const activeUnseen = activeAsset ? unseen[activeAsset] : false;
  useEffect(() => {
    if (activeAsset && activeUnseen) {
      dispatch(markAssetSeen(activeAsset));
    }
  }, [dispatch, activeAsset, activeUnseen]);

  return (
    <div data-tour-step="tabs" className="flex items-center gap-1 rounded-full bg-muted/30 p-1">
      {tabs.map(({ key, labelKey, icon, asset }) => {
        const isActive = key === activeTab;
        const hasUnseen = asset ? unseen[asset] : false;
        const handleClick = () => {
          onTabChange(key);
          if (!isActive && asset && hasUnseen) {
            dispatch(markAssetSeen(asset));
          }
        };
        return (
          <button
            key={key}
            type="button"
            onClick={handleClick}
            className={cn(
              "relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive && (
              <motion.span
                layoutId="project-tab-pill"
                className="absolute inset-0 rounded-full bg-primary"
                style={{ originX: 0.5, originY: 0.5 }}
                transition={{
                  layout: {
                    type: "spring",
                    stiffness: 400,
                    damping: 25,
                  },
                }}
                initial={false}
                animate={{
                  scaleY: [1, 0.85, 1.1, 1],
                  scaleX: [1, 1.15, 0.95, 1],
                  boxShadow: [
                    "0 0 0px 0px oklch(0.591 0.225 26.8 / 0)",
                    "0 0 16px 4px oklch(0.591 0.225 26.8 / 0.6)",
                    "0 0 24px 8px oklch(0.591 0.225 26.8 / 0.4)",
                    "0 0 8px 2px oklch(0.591 0.225 26.8 / 0.25)",
                  ],
                }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <span className="relative">
                {icon}
                {hasUnseen && (
                  <span
                    aria-label="unseen changes"
                    className="absolute -right-1 -top-1 size-1.5 rounded-full bg-[#E63946] ring-2 ring-background"
                  />
                )}
              </span>
              {t(labelKey)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
