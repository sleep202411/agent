"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  createStoryProductionIdempotencyKey,
  patchStoryStoryboardSequence,
  storyProductionKeys,
  type StoryStoryboardSequence,
  type PatchStoryStoryboardSequenceInput,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { useStoryOperationScope } from "../_lib/use-story-operation-scope";
import { StorySequenceSubtitles } from "./story-sequence-subtitles";

export function StorySequenceSubtitlesDialog(props: {
  projectId: string;
  chapterId: string;
  sequence: StoryStoryboardSequence;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editable: boolean;
}) {
  const { user } = useAuth();
  return (
    <SequenceSubtitlesDialogContent
      key={JSON.stringify([props.projectId, props.chapterId, props.sequence.id, user?.id])}
      {...props}
    />
  );
}

function SequenceSubtitlesDialogContent({
  projectId,
  chapterId,
  sequence,
  title,
  open,
  onOpenChange,
  editable,
}: Parameters<typeof StorySequenceSubtitlesDialog>[0]) {
  const { user, isCurrentAccount } = useAuth();
  const t = useTranslations("storyStudio.subtitles");
  const queryClient = useQueryClient();
  const isCurrent = useStoryOperationScope(
    JSON.stringify([projectId, chapterId, sequence.id, user?.id, open, editable])
  );
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const pending = useRef(false);
  const patch = async (
    input: Omit<PatchStoryStoryboardSequenceInput, "expectedVersion" | "description">
  ) => {
    if (
      !open ||
      !editable ||
      !isCurrent() ||
      user?.id == null ||
      !isCurrentAccount(user.id) ||
      pending.current
    )
      throw new DOMException("Subtitle view abandoned", "AbortError");
    pending.current = true;
    setBusy(true);
    const key = storyProductionKeys.storyboard(projectId, chapterId);
    try {
      const current =
        queryClient
          .getQueryData<StoryStoryboardSequence[]>(key)
          ?.find((item) => item.id === sequence.id) ?? sequence;
      const updated = await patchStoryStoryboardSequence(
        projectId,
        chapterId,
        sequence.id,
        createStoryProductionIdempotencyKey("story-node-subtitles"),
        { ...input, expectedVersion: current.version }
      );
      if (!isCurrent() || !isCurrentAccount(user.id))
        throw new DOMException("Subtitle view abandoned", "AbortError");
      queryClient.setQueryData<StoryStoryboardSequence[]>(key, (values) =>
        values?.map((item) => (item.id === sequence.id ? updated : item))
      );
      // The player preview is compiled from saved data, including new subtitle tracks.
      await queryClient.invalidateQueries({
        queryKey: ["story-studio", "node-subtitle-preview", projectId, chapterId, sequence.id],
      });
      if (isCurrent()) toast.success(t("saved"));
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") throw failure;
      if (isCurrent()) await queryClient.invalidateQueries({ queryKey: key });
      throw new Error(storyApiErrorMessage(failure, t("saveError")));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy && !reading) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-0 bg-[oklch(0.22_0_0)] text-white shadow-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("title")} · {title}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <StorySequenceSubtitles
            sequence={sequence}
            projectId={projectId}
            chapterId={chapterId}
            disabled={busy}
            editable={editable}
            onPatch={patch}
            onReadingChange={setReading}
          />
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={busy || reading} onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
