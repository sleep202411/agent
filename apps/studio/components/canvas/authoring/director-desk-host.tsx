"use client";

import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import { DirectorDeskDialog } from "./director-desk-dialog";
import { useDirectorDeskImport } from "./use-director-desk-import";

/**
 * Owns the director-desk overlay and its import listener. Must live outside
 * the left rail — that panel unmounts after the close animation, which would
 * destroy an open dialog even though `directorDeskOpen` stays true.
 */
export function DirectorDeskHost() {
  const { projectId, workspaceId, canEdit } = useProjectContext();
  const directorDesk = useDirectorDeskImport({ workspaceId, projectId, canEdit });

  return (
    <DirectorDeskDialog
      open={directorDesk.isOpen}
      projectId={projectId}
      busy={directorDesk.busy}
      onCapture={directorDesk.capture}
      onOpenChange={directorDesk.setOpen}
    />
  );
}
