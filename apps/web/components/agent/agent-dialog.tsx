"use client";

import { useEffect, useRef } from "react";
import { IconX } from "@tabler/icons-react";
import { api } from "@/src/lib/api";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentStepper } from "@/components/pipeline/pipeline-stepper";
import { PipelineFooter } from "@/components/pipeline/pipeline-footer";
import { StepOutline } from "@/components/pipeline/step-outline";
import { StepCharacters, batchGenerateImages } from "@/components/pipeline/step-characters";
import { generateAllStoryboardAssets } from "@/src/lib/agent/generate-storyboard-assets";
import { StepStoryboard } from "@/components/pipeline/step-storyboard";
import {
  close,
  setCurrentStep,
  setStepStatus,
  updateCharacter,
  updateScene,
  type AgentStep,
} from "@/src/store/slices/agentSlice";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  useOutlineGeneration,
  useCharactersGeneration,
  useStoryboardGeneration,
} from "@/src/hooks/useAgentGeneration";

// Step hints are now resolved inside the component via useTranslations

export function AgentDialog() {
  const t = useTranslations("pipeline");
  const initRef = useRef(false);

  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((s) => s.agent.isOpen);
  const taskId = useAppSelector((s) => s.agent.taskId);
  const agentId = useAppSelector((s) => s.agent.agentId);
  const prompt = useAppSelector((s) => s.agent.prompt);
  const currentStep = useAppSelector((s) => s.agent.currentStep);
  const stepStatuses = useAppSelector((s) => s.agent.stepStatuses);
  const outline = useAppSelector((s) => s.agent.outline);
  const characters = useAppSelector((s) => s.agent.characters);
  const scenes = useAppSelector((s) => s.agent.scenes);
  const props = useAppSelector((s) => s.agent.props);

  // AI generation hooks
  const outlineGen = useOutlineGeneration();
  const charactersGen = useCharactersGeneration();
  const storyboardGen = useStoryboardGeneration();

  // Auto-start generation when dialog opens (skip if resuming with existing data)
  useEffect(() => {
    if (!isOpen || !agentId || !prompt) return;
    if (initRef.current) return;
    // Skip if outline already loaded (resume case)
    if (outline) return;
    initRef.current = true;

    outlineGen.generate({ prompt });
  }, [isOpen, agentId, prompt, outline, outlineGen]);

  // Reset init ref when agent changes
  useEffect(() => {
    initRef.current = false;
  }, [agentId]);

  const handleStepClick = (step: AgentStep) => {
    const status = stepStatuses[step];
    if (status === "done" || step === currentStep) {
      dispatch(setCurrentStep(step));
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      dispatch(setCurrentStep((currentStep - 1) as AgentStep));
    }
  };

  const handleNext = () => {
    if (currentStep < 3 && outline) {
      // Persist edited data before advancing
      if (taskId) {
        if (currentStep === 1) {
          api
            .put(`/api/tasks/${taskId}/steps/1`, {
              data: { stepLabel: "生成大纲", result: outline },
            })
            .catch(console.warn);
        } else if (currentStep === 2) {
          api
            .put(`/api/tasks/${taskId}/steps/2`, {
              data: {
                stepLabel: "提取角色与场景",
                result: { characters, scenes, props },
              },
            })
            .catch(console.warn);
        }
      }

      const nextStep = (currentStep + 1) as AgentStep;
      dispatch(setStepStatus({ step: currentStep, status: "done" }));
      dispatch(setCurrentStep(nextStep));

      if (nextStep === 2) {
        charactersGen.generate({
          title: outline.title,
          background: outline.background,
          conflict: outline.conflict,
          episodes: outline.episodes.map((ep) => ({
            title: ep.title,
            script: ep.script,
          })),
        });
      } else if (nextStep === 3) {
        storyboardGen.generate({
          outline: {
            title: outline.title,
            videoStyle: outline.videoStyle,
            aspectRatio: outline.aspectRatio,
            episodes: outline.episodes.map((ep) => ({
              title: ep.title,
              script: ep.script,
            })),
          },
          characters: characters.map((c) => ({
            name: c.name,
            appearance: c.appearance,
          })),
          scenes: scenes.map((s) => ({
            name: s.name,
            description: s.description,
          })),
        });
      }
    }
  };

  const handleRegenerate = () => {
    if (!outline) return;

    if (currentStep === 1) {
      outlineGen.generate({ prompt: outline.oneLiner || prompt });
    } else if (currentStep === 2) {
      charactersGen.generate({
        title: outline.title,
        background: outline.background,
        conflict: outline.conflict,
        episodes: outline.episodes.map((ep) => ({
          title: ep.title,
          script: ep.script,
        })),
      });
    } else if (currentStep === 3) {
      storyboardGen.generate({
        outline: {
          title: outline.title,
          videoStyle: outline.videoStyle,
          aspectRatio: outline.aspectRatio,
          episodes: outline.episodes.map((ep) => ({
            title: ep.title,
            script: ep.script,
          })),
        },
        characters: characters.map((c) => ({
          name: c.name,
          appearance: c.appearance,
        })),
        scenes: scenes.map((s) => ({
          name: s.name,
          description: s.description,
        })),
      });
    }
  };

  const handleGenerateImages = () => {
    if (currentStep === 2) {
      const agentState = store.getState().agent;
      batchGenerateImages(
        agentState.characters,
        agentState.scenes,
        (id, updates) => store.dispatch(updateCharacter({ id, updates })),
        (id, updates) => store.dispatch(updateScene({ id, updates }))
      );
    } else if (currentStep === 3) {
      generateAllStoryboardAssets();
    }
  };

  const handleApplyToProject = async () => {
    const agentState = store.getState().agent;
    if (!agentState.outline) return;

    try {
      // 1. Create project
      const project = await api.post<{ id: string }>("/aurora/api/projects", {
        data: {
          name: agentState.outline.title,
          description: agentState.outline.oneLiner,
          type: "short-drama",
          style: agentState.outline.videoStyle,
          aspectRatio: agentState.outline.aspectRatio,
        },
      });

      const projectId = project.id;

      // 2. Create characters
      for (const c of agentState.characters) {
        await api.post(`/aurora/api/projects/${projectId}/characters`, {
          data: {
            name: c.name,
            description: `${c.personality}\n${c.appearance}`,
            imagePaths: c.imageUrl ? [c.imageUrl] : [],
          },
        });
      }

      // 3. Create scenes
      for (const s of agentState.scenes) {
        await api.post(`/aurora/api/projects/${projectId}/scenes`, {
          data: {
            name: s.name,
            description: s.description,
            imagePaths: s.imageUrl ? [s.imageUrl] : [],
          },
        });
      }

      // 4. Close dialog and navigate to project
      store.dispatch(close());
      window.location.href = `/projects/${projectId}`;
    } catch (err) {
      console.error("[applyToProject] Failed:", err);
    }
  };

  const stepHints: Record<AgentStep, { generating: string; done: string }> = {
    1: { generating: t("generatingOutline"), done: t("outlineDone") },
    2: { generating: t("generatingCharacters"), done: t("charactersDone") },
    3: { generating: t("generatingStoryboard"), done: t("storyboardDone") },
  };

  const stepStatus = stepStatuses[currentStep];
  const hint =
    stepStatus === "generating" ? stepHints[currentStep].generating : stepHints[currentStep].done;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && dispatch(close())}>
      <DialogPortal>
        <DialogOverlay />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-10">
          <div className="relative flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-popover ring-1 ring-foreground/10">
            {/* Header */}
            <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <DialogTitle className="text-sm font-semibold">
                {outline?.title || "AI Agent"}
              </DialogTitle>

              <AgentStepper
                currentStep={currentStep}
                stepStatuses={stepStatuses}
                onStepClick={handleStepClick}
              />

              <Button
                variant="ghost"
                color="muted"
                size="icon-sm"
                onClick={() => dispatch(close())}
              >
                <IconX className="size-4" />
              </Button>
            </header>

            {/* Step content */}
            <main className="flex-1 overflow-auto p-6">
              {currentStep === 1 && <StepOutline streamingOutline={outlineGen.outline} />}
              {currentStep === 2 && <StepCharacters />}
              {currentStep === 3 && <StepStoryboard />}
            </main>

            {/* Footer */}
            <PipelineFooter
              currentStep={currentStep}
              stepStatus={stepStatus}
              hint={hint}
              onPrev={currentStep > 1 ? handlePrev : undefined}
              onNext={currentStep < 3 ? handleNext : undefined}
              onRegenerate={handleRegenerate}
              onGenerateImages={
                currentStep === 2 || currentStep === 3 ? handleGenerateImages : undefined
              }
              onApplyToProject={currentStep === 3 ? handleApplyToProject : undefined}
            />
          </div>
        </div>
      </DialogPortal>
    </Dialog>
  );
}
