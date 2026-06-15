"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShareScope } from "@/lib/collab/sharing-api";
import { MembersManager } from "./members-manager";

/**
 * Focused share modal — used for per-project sharing (team members live on the
 * Settings/Members page instead). Wraps the shared MembersManager.
 */
export function ShareDialog({
  scope,
  canManage,
  open,
  onOpenChange,
}: {
  scope: ShareScope;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share &ldquo;{scope.name}&rdquo;</DialogTitle>
          <DialogDescription>
            {scope.kind === "workspace"
              ? "Members can collaborate on every project in this team."
              : "Members can collaborate on this project."}
          </DialogDescription>
        </DialogHeader>
        <MembersManager scope={scope} canManage={canManage} />
      </DialogContent>
    </Dialog>
  );
}
