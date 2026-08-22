"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { ShareDialog } from "@/app/_components/share-dialog";
import { isProductionStepSegment } from "../_lib/production-steps";
import { useStoryChapterWorkbench } from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * Project share dialog, mounted once by the [projectId] layout so the rail's
 * Share button opens it in place on every production step.
 */
export function StoryProjectShareDialog({ projectId }: { projectId: string }) {
  const segment = useSelectedLayoutSegment();
  const shareOpen = useStoryProjectUiStore((state) => state.shareOpen);
  const setShareOpen = useStoryProjectUiStore((state) => state.setShareOpen);
  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const project = workbenchQuery.data?.project ?? null;
  if (!isProductionStepSegment(segment) || !project) return null;
  return (
    <ShareDialog
      scope={{ kind: "story-project", id: projectId, name: project.title }}
      canManage={project.capabilities.includes("story.admin")}
      open={shareOpen}
      onOpenChange={setShareOpen}
    />
  );
}
