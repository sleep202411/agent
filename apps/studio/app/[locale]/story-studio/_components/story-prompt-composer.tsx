"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  PromptTextarea,
  type PromptReferencePickerSession,
} from "@/components/canvas/authoring/prompt-textarea";
import type { MentionItem } from "@/lib/prompt-mentions";
import { listStoryAssetSpecs, storyProductionKeys } from "@/lib/story-production-api";
import type { StoryCandidateAsset } from "@/lib/story-projects-api";
import { StoryCandidateAssetPickerDialog } from "./project-canvas/story-candidate-asset-picker-dialog";

/**
 * Chapter Asset Specs are the durable reference vocabulary used by Story
 * prompts. The visible chip can show the current preview while its wire token
 * remains `@stableKey`, so renaming an asset never breaks a saved prompt.
 */
export function useStoryAssetMentions(projectId: string, chapterId: string): MentionItem[] {
  const assetsQuery = useQuery({
    queryKey: storyProductionKeys.assets(projectId, chapterId),
    queryFn: ({ signal }) => listStoryAssetSpecs(projectId, chapterId, signal),
    enabled: Boolean(chapterId),
    retry: false,
  });
  return useMemo(
    () =>
      (assetsQuery.data ?? []).map((asset) => ({
        id: asset.id,
        label: asset.stableKey,
        name: asset.name,
        kind: "image" as const,
        previewUrl:
          asset.selectedMediaVersion?.thumbnailUrl ??
          asset.selectedMediaVersion?.previewUrl ??
          undefined,
        assetId: asset.selectedMediaVersion?.mediaAssetId,
        width: asset.selectedMediaVersion?.width,
        height: asset.selectedMediaVersion?.height,
        durationSeconds: asset.selectedMediaVersion?.durationSeconds,
      })),
    [assetsQuery.data]
  );
}

/**
 * Story-domain adapter for the shared canvas Prompt editor. `@` deliberately
 * opens the existing Story candidate-media picker. The picker receives the
 * selected media of chapter Asset Specs; the editor persists the corresponding
 * stable-key token so later generation resolves the same logical asset.
 */
export function StoryPromptComposer({
  id,
  value,
  onChange,
  disabled = false,
  required = false,
  maxLength,
  mentions,
  excludeMentionId,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  required?: boolean;
  maxLength?: number;
  mentions: readonly MentionItem[];
  excludeMentionId?: string;
}) {
  const [pickerSession, setPickerSession] = useState<PromptReferencePickerSession | null>(null);
  const availableMentions = useMemo(
    () =>
      mentions.filter(
        (mention) =>
          mention.id !== excludeMentionId &&
          mention.kind === "image" &&
          Boolean(mention.assetId && mention.previewUrl)
      ),
    [excludeMentionId, mentions]
  );
  const mentionByMediaAssetId = useMemo(
    () =>
      new Map(availableMentions.map((mention) => [mention.assetId as string, mention] as const)),
    [availableMentions]
  );
  const candidateAssets = useMemo<StoryCandidateAsset[]>(
    () =>
      availableMentions.map((mention) => ({
        asset: {
          id: mention.assetId as string,
          kind: "image",
          status: "ready",
          moderationStatus: "approved",
          contentType: "image/png",
          width: mention.width ?? null,
          height: mention.height ?? null,
          durationSeconds: mention.durationSeconds ?? null,
          checksumSha256: null,
          previewUrl: mention.previewUrl ?? null,
        },
        videoVariant: null,
        addedByUserId: "",
        addedAt: "",
      })),
    [availableMentions]
  );

  const closePicker = () => {
    const session = pickerSession;
    setPickerSession(null);
    session?.dismiss();
  };

  const pickCandidate = async (candidate: StoryCandidateAsset) => {
    const session = pickerSession;
    const mention = mentionByMediaAssetId.get(candidate.asset.id);
    if (!session || !mention) return;
    setPickerSession(null);
    session.pick(mention);
  };

  return (
    <>
      <PromptTextarea
        id={id}
        value={value}
        onCommit={onChange}
        mentions={mentions}
        disabled={disabled}
        maxLength={maxLength}
        rows={6}
        aria-required={required}
        className="h-auto min-h-40"
        editorClassName="min-h-40 bg-transparent px-0 py-2 text-[15px] leading-7 text-white/88 outline-none md:text-[15px]"
        onOpenReferencePicker={setPickerSession}
      />

      <StoryCandidateAssetPickerDialog
        open={pickerSession !== null}
        onOpenChange={(open) => {
          if (!open) closePicker();
        }}
        items={candidateAssets}
        allowedKinds={["image"]}
        canSelect={!disabled}
        onSelect={pickCandidate}
      />
    </>
  );
}
