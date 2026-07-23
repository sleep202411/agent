"use client";

import { IconArrowDownRight, IconMovie } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export interface StoryProductionCanvasEntryProps {
  onOpen: () => void;
}

/** Opens the project-wide media-authoring canvas from a selected clip. */
export function StoryProductionCanvasEntry({ onOpen }: StoryProductionCanvasEntryProps) {
  const t = useTranslations("storyStudio.canvas.inspector.productionCanvas");

  return (
    <section className="mt-3 rounded-[18px] bg-white/[0.055] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-white/72">
          <IconMovie className="size-4.5" stroke={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-white/82">{t("title")}</h3>
          <p className="mt-1 text-[10px] leading-4 text-white/38">{t("description")}</p>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={onOpen}
        className="mt-3 h-10 w-full rounded-xl bg-white/[0.1] text-white hover:bg-white/[0.15]"
      >
        <IconArrowDownRight className="size-4" />
        {t("action")}
      </Button>
      <p className="mt-2 text-center text-[9px] leading-4 text-white/28">{t("hint")}</p>
    </section>
  );
}
