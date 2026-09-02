"use client";

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
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { StoryPromptComposer, useStoryAssetMentions } from "./story-prompt-composer";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

/**
 * Detail dialog for one Storyboard clip — the clip-side twin of the Asset Spec
 * detail dialog: the clip's single prompt (image or video, by clip kind) is
 * editable, and the next generation's model is explicit. Generation stays
 * strictly user-clicked.
 */
export function StoryClipDetailDialog({
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
  /** False while the aggregate Storyboard stage is stale; inspection stays available. */
  editable?: boolean;
}) {
  const t = useTranslations("storyStudio.assetsPage.detailDialog");
  const queryClient = useQueryClient();
  const defaults = useStoryProductionGenerationDefaults(projectId, clip.kind);
  const models = defaults.models;
  const mentions = useStoryAssetMentions(projectId, chapterId);
  const savedPrompt = (clip.kind === "image" ? clip.imagePrompt : clip.videoPrompt) ?? "";
  const [prompt, setPrompt] = useState(savedPrompt);
  // null = follow the page-level default until the creator picks explicitly.
  const [modelId, setModelId] = useState<string | null>(null);
  const effectiveModelId = modelId ?? defaults.model?.id ?? null;
  const promptDirty = prompt.trim() !== savedPrompt;

  const invalidateStoryboard = () =>
    queryClient.invalidateQueries({
      queryKey: storyProductionKeys.storyboard(projectId, chapterId),
    });

  const patchPrompt = () =>
    patchStoryStoryboardClip(
      projectId,
      chapterId,
      sequenceId,
      clip.id,
      createStoryProductionIdempotencyKey("story-clip-patch"),
      {
        expectedVersion: clip.version,
        ...(clip.kind === "image"
          ? { imagePrompt: prompt.trim() }
          : { videoPrompt: prompt.trim() }),
      }
    );

  const saveMutation = useMutation({
    retry: false,
    mutationFn: patchPrompt,
    onSuccess: async () => {
      toast.success(t("saved"));
      await invalidateStoryboard();
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("saveError"))),
  });

  const generateMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      // A dirty prompt is persisted first so the generation uses exactly what
      // the creator sees; the patched version fences the create call.
      let version = clip.version;
      if (promptDirty) {
        const patched = await patchPrompt();
        version = patched.version;
      }
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
    },
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

  const busy = saveMutation.isPending || generateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setPrompt(savedPrompt);
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
            onChange={setPrompt}
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
                variant="secondary"
                disabled={!promptDirty || busy}
                loading={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {t("save")}
              </Button>
              <Button
                type="button"
                disabled={busy}
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
