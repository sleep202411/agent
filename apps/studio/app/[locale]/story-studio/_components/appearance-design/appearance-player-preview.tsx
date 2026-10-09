"use client";

import type { StoryProjectSummary } from "@/lib/story-projects-api";
import { useMemo, type ReactNode } from "react";
import { AppearancePlayerFrame, type AppearancePlayerFrameProps } from "./appearance-player-frame";
import { AppearancePreview } from "./appearance-preview";

import {
  ExperienceCoreChoiceRendererConfigSchema,
  ExperienceRuntimeManifestSchema,
} from "@repo/shared/experience-runtime";

type PlayerProps = Omit<AppearancePlayerFrameProps, "appearance">;

/** The player remains mounted while creator messages change its appearance. */
export function AppearancePlayerPreview({
  projectId,
  projectTitle,
  backHref,
  previewTools,
  project,
  ...player
}: PlayerProps & {
  projectId?: string;
  projectTitle?: string;
  backHref?: string;
  previewTools?: ReactNode;
  project?: StoryProjectSummary;
}) {
  const choiceLabels = useMemo(() => {
    const parsed = ExperienceRuntimeManifestSchema.safeParse(player.runtime);
    if (!parsed.success) return [];
    return parsed.data.graph.nodes
      .flatMap((node) => (node.kind === "scene" ? node.renderers : []))
      .flatMap((renderer) => {
        if (renderer.rendererId !== "core.choice") return [];
        const config = ExperienceCoreChoiceRendererConfigSchema.safeParse(renderer.config);
        if (!config.success) return [];
        return config.data.choices.map((choice) =>
          (
            choice.label?.[player.locale] ??
            choice.label?.[parsed.data.localization.defaultLocale] ??
            ""
          ).slice(0, 500)
        );
      })
      .slice(0, 12);
  }, [player.runtime, player.locale]);
  return (
    <AppearancePreview
      project={project}
      projectId={projectId}
      projectTitle={projectTitle}
      backHref={backHref}
      previewTools={previewTools}
      choiceLabels={choiceLabels}
      renderStage={(stage) => <AppearancePlayerFrame {...player} appearance={stage.appearance} />}
    />
  );
}
