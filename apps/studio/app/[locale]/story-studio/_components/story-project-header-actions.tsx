"use client";

import { IconCloudUpload, IconLoader2 } from "@tabler/icons-react";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/_components/auth-provider";
import { Button } from "@/components/ui/button";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { storyChapterWorkbenchQueryKey } from "../_lib/use-story-chapter-workbench";
import { useStoryPublicationDialog } from "../_lib/use-story-publication-dialog";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryProjectCreditsBadge } from "./story-project-credits-badge";
import { StoryPublicationDetailsDialog } from "./story-publication-details-dialog";

export function StoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  if (user?.id == null) return null;
  return <AccountStoryProjectHeaderActions key={`${user.id}:${projectId}`} projectId={projectId} />;
}

function AccountStoryProjectHeaderActions({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations("storyStudio.canvas");
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const { open, openPublication, closePublication, pending } = useStoryPublicationDialog(projectId);
  const workbenchQuery = useQuery({
    queryKey: activeChapterId
      ? storyChapterWorkbenchQueryKey(projectId, activeChapterId, user?.id ?? null)
      : ["story-studio", "script-workbench", projectId, user?.id ?? null],
    queryFn: ({ signal }) => getStoryWorkbench(projectId, activeChapterId ?? undefined, signal),
    enabled: Boolean(projectId && user),
    retry: false,
  });
  const canEdit =
    !workbenchQuery.data || workbenchQuery.data.project.capabilities.includes("story.edit");

  return (
    <>
      <Button
        ref={publishButtonRef}
        type="button"
        variant="ghost"
        size="lg"
        disabled={pending}
        onClick={() => void openPublication()}
        className="h-9 gap-2 rounded-[14px] bg-transparent px-3 font-semibold text-white/68 hover:bg-white/[0.1] hover:text-white"
      >
        {pending ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : (
          <IconCloudUpload className="size-4" />
        )}
        <span>{t("publish.entry")}</span>
      </Button>
      <StoryProjectCreditsBadge projectId={projectId} />
      {!canEdit ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-[14px] bg-white px-3 text-[11px] font-semibold text-black">
          {t("readOnly")}
        </span>
      ) : null}
      <StoryPublicationDetailsDialog
        projectId={projectId}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closePublication();
        }}
        workbench={workbenchQuery.data}
        loading={workbenchQuery.isPending}
        error={workbenchQuery.error}
        onRetry={() => void workbenchQuery.refetch()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          publishButtonRef.current?.focus();
        }}
      />
    </>
  );
}
