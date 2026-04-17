"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  IconArrowLeft,
  IconArrowRight,
  IconRefresh,
  IconSparkles,
  IconPalette,
} from "@tabler/icons-react";
import type { AgentStep, StepStatus } from "@/src/store/slices/agentSlice";

interface PipelineFooterProps {
  currentStep: AgentStep;
  stepStatus: StepStatus;
  hint: string;
  onPrev?: () => void;
  onNext?: () => void;
  onRegenerate?: () => void;
  onGenerateImages?: () => void;
  onApplyToProject?: () => void;
}

export function PipelineFooter({
  currentStep,
  stepStatus,
  hint,
  onPrev,
  onNext,
  onRegenerate,
  onGenerateImages,
  onApplyToProject,
}: PipelineFooterProps) {
  const t = useTranslations("pipeline");
  const tc = useTranslations("common");
  const isGenerating = stepStatus === "generating";
  const isDone = stepStatus === "done";

  return (
    <div className="flex items-center justify-between border-t border-border bg-card px-6 py-3">
      <p className="text-sm text-muted-foreground">{hint}</p>

      <div className="flex items-center gap-2">
        {currentStep > 1 && (
          <Button variant="outline" color="muted" onClick={onPrev} disabled={isGenerating}>
            <IconArrowLeft className="size-4" />
            {t("prevStep")}
          </Button>
        )}

        {onRegenerate && (
          <Button variant="outline" color="muted" onClick={onRegenerate} disabled={isGenerating}>
            <IconRefresh className="size-4" />
            {tc("regenerate")}
          </Button>
        )}

        {onGenerateImages && (
          <Button
            variant="outline"
            color="muted"
            onClick={onGenerateImages}
            disabled={isGenerating}
          >
            <IconPalette className="size-4" />
            {currentStep === 3 ? t("generateAllMaterials") : t("generateCharacterImages")}
          </Button>
        )}

        {currentStep < 3 && onNext && (
          <Button onClick={onNext} disabled={!isDone || isGenerating}>
            {t("nextStep")}
            <IconArrowRight className="size-4" />
          </Button>
        )}

        {currentStep === 3 && onApplyToProject && (
          <Button onClick={onApplyToProject} disabled={!isDone || isGenerating}>
            <IconSparkles className="size-4" />
            {t("applyToProject")}
          </Button>
        )}
      </div>
    </div>
  );
}
