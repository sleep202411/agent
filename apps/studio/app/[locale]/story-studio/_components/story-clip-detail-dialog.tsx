"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { useState } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createStoryProductionIdempotencyKey,
  createStoryStoryboardClipGeneration,
  patchStoryStoryboardClip,
  storyProductionKeys,
  type StoryStoryboardClip,
  type StoryStoryboardSequence,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { StoryPromptComposer, useStoryAssetMentions } from "./story-prompt-composer";
import { useStoryProductionAutosave } from "./use-story-production-autosave";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

/**
 * Detail dialog for one Storyboard clip — the clip-side twin of the Asset Spec
 * detail dialog: the clip's single prompt (image or video, by clip kind) is
 * editable, and the next generation's model is explicit. Generation stays
 * strictly user-clicked.
 */
export function StoryClipDetailDialog(
  props: React.ComponentProps<typeof StoryClipDetailDialogContent>
) {
  const { user } = useAuth();
  return (
    <StoryClipDetailDialogContent
      key={JSON.stringify([
        props.projectId,
        props.chapterId,
        props.sequenceId,
        props.clip.id,
        user?.id,
      ])}
      {...props}
    />
  );
}

function StoryClipDetailDialogContent({
  clip,
  sequenceId,
  projectId,
  chapterId,
  open,
  onOpenChange,
  editable = true,
}: {
  clip: StoryStoryboardClip;
  sequenceId: string;
  projectId: string;
  chapterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False when the owning surface is read-only; inspection stays available. */
  editable?: boolean;
}) {
  const { user, isCurrentAccount } = useAuth();
  const t = useTranslations("storyStudio.assetsPage.detailDialog");
  const queryClient = useQueryClient();
  const defaults = useStoryProductionGenerationDefaults(projectId, clip.kind);
  const models = defaults.models;
  const mentions = useStoryAssetMentions(projectId, chapterId);

  // null = follow the page-level default until the creator picks explicitly.
  const [modelId, setModelId] = useState<string | null>(null);
  const effectiveModelId = modelId ?? defaults.model?.id ?? null;

  const invalidateStoryboard = () =>
    queryClient.invalidateQueries({
      queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    });

  const { values, changeValues, runWithSavedValues } = useStoryProductionAutosave({
    initialValues: { prompt: (clip.kind === "image" ? clip.imagePrompt : clip.videoPrompt) ?? "" },
    canPersist: () => user?.id != null && isCurrentAccount(user.id),
    scopeKey: JSON.stringify([projectId, chapterId, sequenceId, clip.id, user?.id, editable]),
    persist: async ({ prompt }) => {
      const key = storyProductionKeys.storyboard(projectId, chapterId);
      const current =
        queryClient
          .getQueryData<StoryStoryboardSequence[]>(key)
          ?.find((sequence) => sequence.id === sequenceId)
          ?.clips.find((item) => item.id === clip.id) ?? clip;
      const savedPrompt =
        (current.kind === "image" ? current.imagePrompt : current.videoPrompt) ?? "";
      if (!prompt.trim() || prompt.trim() === savedPrompt) return current.version;
      const updated = await patchStoryStoryboardClip(
        projectId,
        chapterId,
        sequenceId,
        clip.id,
        createStoryProductionIdempotencyKey("story-clip-patch"),
        {
          expectedVersion: current.version,
          ...(clip.kind === "image"
            ? { imagePrompt: prompt.trim() }
            : { videoPrompt: prompt.trim() }),
        }
      );
      queryClient.setQueryData<StoryStoryboardSequence[]>(key, (sequences) =>
        sequences?.map((sequence) =>
          sequence.id === sequenceId
            ? {
                ...sequence,
                clips: sequence.clips.map((item) => (item.id === clip.id ? updated : item)),
              }
            : sequence
        )
      );
      return updated.version;
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("saveError"))),
  });
  const { prompt } = values;

  const generateMutation = useMutation({
    retry: false,
    mutationFn: () =>
      runWithSavedValues(async (version) => {
        const model = models.find((candidate) => candidate.id === effectiveModelId);
        return createStoryStoryboardClipGeneration(
          projectId,
          chapterId,
          sequenceId,
          clip.id,
          createStoryProductionIdempotencyKey("story-generate"),
          {
            expectedVersion: version,
            ...(model ? { modelId: model.id, schemaVersion: model.schemaVersion } : {}),
          }
        );
      }),
    onSuccess: async () => {
      toast.success(t("generateStarted"));
      await invalidateStoryboard();
      onOpenChange(false);
    },
    onError: async (error) => {
      toast.error(storyApiErrorMessage(error, t("generateError")));
      await invalidateStoryboard();
    },
  });

  const busy = generateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-0 bg-[oklch(0.22_0_0)] text-white shadow-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{clip.title}</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            @{clip.stableKey} · {Number((clip.durationMs / 1000).toFixed(1))}s
          </DialogDescription>
        </DialogHeader>

        {clip.description ? (
          <p className="text-sm leading-6 text-white/70">{clip.description}</p>
        ) : null}

        <Field
          dense
          label={clip.kind === "image" ? t("imagePrompt") : t("videoPrompt")}
          htmlFor={`clip-detail-prompt-${clip.id}`}
        >
          <StoryPromptComposer
            id={`clip-detail-prompt-${clip.id}`}
            value={prompt}
            disabled={busy || !editable}
            onChange={(prompt) => changeValues({ prompt })}
            mentions={mentions}
          />
        </Field>

        <Field dense label={t("model")} htmlFor={`clip-detail-model-${clip.id}`}>
          <Select
            value={effectiveModelId ?? undefined}
            onValueChange={setModelId}
            disabled={busy || !editable || models.length === 0}
          >
            <SelectTrigger id={`clip-detail-model-${clip.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
          {editable ? (
            <>
              <Button
                type="button"
                disabled={busy || !prompt.trim()}
                loading={generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                {generateMutation.isPending ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconSparkles />
                )}
                {t("generate")}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
