"use client";

import { IconArrowRight, IconBulb, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PanelLayout } from "./panel-layout";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { setActiveTab, setAiPanelOpen } from "@/src/store/slices/projectSlice";

const inspirationCards = [
  {
    titleKey: "splitStoryboard" as const,
    descKey: "splitStoryboardDesc" as const,
    tab: "script" as const,
    action: "script_storyboard",
  },
  {
    titleKey: "supplementAssets" as const,
    descKey: "supplementAssetsDesc" as const,
    tab: "storyboard" as const,
    action: "world_assets",
  },
  {
    titleKey: "optimizeTimeline" as const,
    descKey: "optimizeTimelineDesc" as const,
    tab: "timeline" as const,
    action: "timeline_polish",
  },
];

export function InspirationPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("inspiration");

  return (
    <PanelLayout title={t("title")} onClose={onClose}>
      <div className="space-y-3 p-3">
        <div className="rounded-xl border border-border bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBulb className="size-4 text-primary" />
            {t("currentProjectHint")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        </div>

        {inspirationCards.map((card) => (
          <div key={card.action} className="rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{t(card.titleKey)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(card.descKey)}</p>
              </div>
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <IconSparkles className="size-4" />
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="outline"
                color="muted"
                onClick={() => {
                  setActiveTab(card.tab);
                  onClose();
                }}
              >
                {t("openView")}
                <IconArrowRight className="size-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setActiveTab(card.tab);
                  setAiPanelOpen(true);
                  onClose();
                }}
              >
                {t("continueWithAi")}
                <IconSparkles className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </PanelLayout>
  );
}
