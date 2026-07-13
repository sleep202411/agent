"use client";

import {
  IconGitBranch,
  IconMovie,
  IconPlus,
  IconRoute,
  IconSparkles,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";

export type StoryNodeCreationKind = "clip" | "choice" | "router" | "ending";

interface StoryNodeCreatorProps {
  open: boolean;
  canAddChoice: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (kind: StoryNodeCreationKind) => void;
}

interface CreatorItem {
  kind: StoryNodeCreationKind;
  icon: Icon;
  color: string;
  iconBackground: string;
}

const CREATOR_ITEMS: CreatorItem[] = [
  {
    kind: "clip",
    icon: IconMovie,
    color: "rgba(255,255,255,0.14)",
    iconBackground: "rgba(255,255,255,0.22)",
  },
  {
    kind: "choice",
    icon: IconGitBranch,
    color: "rgba(91,157,255,0.38)",
    iconBackground: "rgba(91,157,255,0.62)",
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

export function StoryNodeCreator({
  open,
  canAddChoice,
  onOpenChange,
  onCreate,
}: StoryNodeCreatorProps) {
  const t = useTranslations("storyStudio.canvas");

  return (
    <div className="absolute top-5 left-5 z-30">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "grid size-11 place-items-center rounded-full bg-[#E52227] text-white shadow-[0_12px_36px_rgba(229,34,39,0.28)] transition hover:bg-[#f02b30]",
          open &&
            "rotate-90 bg-white text-black shadow-[0_12px_36px_rgba(0,0,0,0.36)] hover:bg-white/90"
        )}
        aria-expanded={open}
        aria-label={t("addNode")}
        title={t("addNode")}
      >
        {open ? <IconX className="size-5" /> : <IconPlus className="size-5" />}
      </button>

      {open ? (
        <FrostedPanel className="absolute top-14 left-0 w-[310px] rounded-[22px] bg-[oklch(0.225_0_0/0.9)] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.52)] backdrop-blur-[40px]">
          <div className="px-3 pt-2 pb-2.5">
            <p className="text-xs font-semibold text-white/86">{t("creator.title")}</p>
            <p className="mt-1 text-[10px] leading-4 text-white/38">{t("creator.description")}</p>
          </div>
          <div className="grid gap-1">
            {CREATOR_ITEMS.map((item) => {
              const disabled = item.kind === "choice" && !canAddChoice;
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.kind}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onCreate(item.kind);
                    onOpenChange(false);
                  }}
                  className="group flex min-h-16 w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-36"
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
                      {disabled
                        ? t("creator.choiceUnavailable")
                        : t(`creator.${item.kind}Description`)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </FrostedPanel>
      ) : null}
    </div>
  );
}
