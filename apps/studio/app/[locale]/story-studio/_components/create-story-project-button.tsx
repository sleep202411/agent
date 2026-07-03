"use client";

import { useState } from "react";
import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { ensurePersonalWorkspace } from "@/lib/collab/projects-api";
import { createStoryProject } from "@/lib/story-projects-api";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Create project failed.";
}

export function CreateStoryProjectButton() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate() {
    if (isCreating) return;
    setIsCreating(true);

    try {
      // Story projects are their own domain — ONE create call. The personal
      // workspace is resolved only to anchor covers/media accounting.
      const workspace = await ensurePersonalWorkspace();
      const project = await createStoryProject({ workspaceId: workspace.id });

      toast.success("Project created.");
      router.push(`/story-studio/editor?projectId=${project.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setIsCreating(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={isCreating}
      className="inline-flex h-10 items-center gap-2 rounded-[15px] bg-white px-4 text-[14px] font-bold text-black shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition hover:bg-white/90 disabled:cursor-wait disabled:bg-white/78 disabled:text-black/70"
    >
      {isCreating ? (
        <IconLoader2 className="size-4 animate-spin" stroke={2.2} />
      ) : (
        <IconPlus className="size-4" stroke={2.2} />
      )}
      {isCreating ? "Creating..." : "Create Project"}
    </button>
  );
}
