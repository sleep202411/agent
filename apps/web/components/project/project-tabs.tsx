"use client";

import { IconFileText, IconLayoutGrid, IconClock } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type ProjectTab = "script" | "storyboard" | "timeline";

const tabs: { key: ProjectTab; labelKey: string; icon: React.ReactNode }[] = [
  { key: "script", labelKey: "script", icon: <IconFileText className="size-4" /> },
  { key: "storyboard", labelKey: "storyboard", icon: <IconLayoutGrid className="size-4" /> },
  { key: "timeline", labelKey: "timeline", icon: <IconClock className="size-4" /> },
];

interface ProjectTabsProps {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}

export function ProjectTabs({ activeTab, onTabChange }: ProjectTabsProps) {
  const t = useTranslations("tabs");
  return (
    <div data-tour-step="tabs" className="flex items-center gap-1 rounded-full bg-muted/30 p-1">
      {tabs.map(({ key, labelKey, icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onTabChange(key)}
          className={cn(
            "relative flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            key === activeTab
              ? "text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {key === activeTab && (
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
            {icon}
            {t(labelKey)}
          </span>
        </button>
      ))}
    </div>
  );
}
