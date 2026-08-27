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
  createStoryAssetGeneration,
  createStoryProductionIdempotencyKey,
  patchStoryAssetSpec,
  storyProductionKeys,
  type StoryAssetSpec,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { StoryPromptMentionField, useStoryAssetMentions } from "./story-prompt-mention-field";
import { useStoryProductionGenerationDefaults } from "./use-story-production-generation-defaults";

/**
 * Detail dialog for one Asset Spec: the full identity plus the two knobs the
 * card deliberately hides — an editable image prompt (PATCH, optimistic
 * version) and a model choice for the next generation. Generation stays
 * strictly user-clicked; closing the dialog never submits anything.
 */
export function StoryAssetSpecDetailDialog({
  asset,
  projectId,
  chapterId,
  open,
  onOpenChange,
  editable = true,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False while the aggregate Asset stage is stale; inspection stays available. */
  editable?: boolean;
}) {
  const t = useTranslations("storyStudio.assetsPage.detailDialog");
  const queryClient = useQueryClient();
  const defaults = useStoryProductionGenerationDefaults(projectId, "image");
  const models = defaults.models;
  const mentions = useStoryAssetMentions(projectId, chapterId);
  const [prompt, setPrompt] = useState(asset.imagePrompt);
  // null = follow the page-level default until the creator picks explicitly.
  const [modelId, setModelId] = useState<string | null>(null);
  const effectiveModelId = modelId ?? defaults.model?.id ?? null;
  const reference = asset.stableKey.startsWith("@") ? asset.stableKey : `@${asset.stableKey}`;
  const promptDirty = prompt.trim() !== asset.imagePrompt;

  const invalidateAssets = () =>
    queryClient.invalidateQueries({
      queryKey: storyProductionKeys.assets(projectId, chapterId),
    });

  const saveMutation = useMutation({
    retry: false,
    mutationFn: () =>
      patchStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-patch"),
        { expectedVersion: asset.version, imagePrompt: prompt.trim() }
      ),
    onSuccess: async () => {
      toast.success(t("saved"));
      await invalidateAssets();
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("saveError"))),
  });

  const generateMutation = useMutation({
    retry: false,
    mutationFn: async () => {
      // A dirty prompt is persisted first so the generation uses exactly what
      // the creator sees; the patched version fences the create call.
      let version = asset.version;
      if (promptDirty) {
        const patched = await patchStoryAssetSpec(
          projectId,
          chapterId,
          asset.id,
          createStoryProductionIdempotencyKey("story-asset-patch"),
          { expectedVersion: asset.version, imagePrompt: prompt.trim() }
        );
        version = patched.version;
      }
      const model = models.find((candidate) => candidate.id === effectiveModelId);
      return createStoryAssetGeneration(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-generate"),
        {
          expectedVersion: version,
          ...(model ? { modelId: model.id, schemaVersion: model.schemaVersion } : {}),
        }
      );
    },
    onSuccess: async () => {
      toast.success(t("generateStarted"));
      await invalidateAssets();
      onOpenChange(false);
    },
    onError: async (error) => {
      toast.error(storyApiErrorMessage(error, t("generateError")));
      await invalidateAssets();
    },
  });

  const busy = saveMutation.isPending || generateMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setPrompt(asset.imagePrompt);
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-0 bg-[oklch(0.22_0_0)] text-white shadow-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.name}</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">{reference}</DialogDescription>
        </DialogHeader>

        {asset.description ? (
          <p className="text-sm leading-6 text-white/70">{asset.description}</p>
        ) : null}

        <Field dense label={t("imagePrompt")} htmlFor={`asset-detail-prompt-${asset.id}`}>
          <StoryPromptMentionField
            id={`asset-detail-prompt-${asset.id}`}
            value={prompt}
            disabled={busy || !editable}
            onChange={setPrompt}
            mentions={mentions}
          />
        </Field>

        <Field dense label={t("model")} htmlFor={`asset-detail-model-${asset.id}`}>
          <Select
            value={effectiveModelId ?? undefined}
            onValueChange={setModelId}
            disabled={busy || !editable || models.length === 0}
          >
            <SelectTrigger id={`asset-detail-model-${asset.id}`} className="w-full">
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
