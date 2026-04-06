"use client";

import {
  IconArrowRight,
  IconCheck,
  IconCircleDashed,
  IconMovie,
  IconPencil,
  IconPhoto,
  IconSparkles,
  IconTimeline,
  IconUser,
  IconMap,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PanelLayout } from "./panel-layout";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setActiveTab,
  setActivePanel,
  setAiPanelOpen,
  selectCurrentInstance,
} from "@/src/store/slices/projectSlice";
import type { WorkspaceTab, WorkspacePanelKey } from "@/src/types/workspace";

interface InspirationStep {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: string;
  descKey: string;
  action:
    | { type: "tab"; tab: WorkspaceTab; ai?: boolean }
    | { type: "panel"; panel: WorkspacePanelKey };
  check: (state: ProjectState) => boolean;
}

interface ProjectState {
  episodeCount: number;
  characterCount: number;
  sceneCount: number;
  shotCount: number;
  shotsWithImage: number;
}

const steps: InspirationStep[] = [
  {
    key: "script",
    icon: IconPencil,
    titleKey: "stepScript",
    descKey: "stepScriptDesc",
    action: { type: "tab", tab: "script" },
    check: () => true, // script content isn't tracked in store, always show as guide
  },
  {
    key: "episodes",
    icon: IconMovie,
    titleKey: "stepEpisodes",
    descKey: "stepEpisodesDesc",
    action: { type: "panel", panel: "episodes" },
    check: (s) => s.episodeCount > 0,
  },
  {
    key: "characters",
    icon: IconUser,
    titleKey: "stepCharacters",
    descKey: "stepCharactersDesc",
    action: { type: "panel", panel: "characters" },
    check: (s) => s.characterCount > 0,
  },
  {
    key: "scenes",
    icon: IconMap,
    titleKey: "stepScenes",
    descKey: "stepScenesDesc",
    action: { type: "panel", panel: "scenes" },
    check: (s) => s.sceneCount > 0,
  },
  {
    key: "storyboard",
    icon: IconPhoto,
    titleKey: "stepStoryboard",
    descKey: "stepStoryboardDesc",
    action: { type: "tab", tab: "storyboard", ai: true },
    check: (s) => s.shotCount > 0 && s.shotsWithImage > 0,
  },
  {
    key: "timeline",
    icon: IconTimeline,
    titleKey: "stepTimeline",
    descKey: "stepTimelineDesc",
    action: { type: "tab", tab: "timeline" },
    check: (s) => s.shotCount > 0,
  },
];

function useProjectState(): ProjectState {
  const inst = useAppSelector(selectCurrentInstance);
  const rows = inst.rows;

  const shotsWithImage = rows.filter((row) =>
    row.shotValues?.some(
      (v) =>
        v.presetColumnKey === "storyboard" &&
        ((v.files && Array.isArray(v.files) && v.files.length > 0) ||
          (v.value && v.value.trim().length > 0))
    )
  ).length;

  return {
    episodeCount: inst.episodes.length,
    characterCount: inst.characters.length,
    sceneCount: inst.scenes.length,
    shotCount: rows.length,
    shotsWithImage,
  };
}

function handleStepAction(step: InspirationStep, onClose: () => void) {
  if (step.action.type === "tab") {
    store.dispatch(setActiveTab(step.action.tab));
    if (step.action.ai) {
      store.dispatch(setAiPanelOpen(true));
    }
  } else {
    store.dispatch(setActivePanel(step.action.panel));
  }
  onClose();
}

export function InspirationPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("inspiration");
  const projectState = useProjectState();

  const completedCount = steps.filter((s) => s.check(projectState)).length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <PanelLayout title={t("title")} onClose={onClose}>
      <div className="space-y-3">
        {/* Progress overview */}
        <div className="rounded-xl border border-border bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("projectProgress")}</span>
            <span className="text-xs text-muted-foreground">
              {completedCount}/{steps.length}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("progressHint")}</p>
        </div>

        {/* Step cards */}
        {steps.map((step) => {
          const done = step.check(projectState);
          const StepIcon = step.icon;

          return (
            <div
              key={step.key}
              className={cn(
                "rounded-xl border border-border p-3 transition-colors",
                done && "opacity-60"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? <IconCheck className="size-4" /> : <StepIcon className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3
                      className={cn(
                        "text-sm font-medium",
                        done && "line-through text-muted-foreground"
                      )}
                    >
                      {t(step.titleKey)}
                    </h3>
                    {done ? <IconCircleDashed className="size-3.5 text-primary" /> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t(step.descKey)}</p>
                  {!done && (
                    <Button
                      size="sm"
                      variant="outline"
                      color="muted"
                      className="mt-2"
                      onClick={() => handleStepAction(step, onClose)}
                    >
                      {t("goTo")}
                      <IconArrowRight className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* AI shortcut */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <IconSparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">{t("aiAssistant")}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("aiAssistantDesc")}</p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  store.dispatch(setAiPanelOpen(true));
                  onClose();
                }}
              >
                <IconSparkles className="size-3.5" />
                {t("openAi")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PanelLayout>
  );
}
