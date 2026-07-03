"use client";

import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShareScope } from "@/lib/collab/sharing-api";
import { MembersManager } from "./members-manager";
import { CastingManager } from "./casting-manager";

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
  const t = useTranslations("shell");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("share.title", { name: scope.name })}</DialogTitle>
          <DialogDescription>
            {scope.kind === "workspace"
              ? t("share.descriptionWorkspace")
              : t("share.descriptionProject")}
          </DialogDescription>
        </DialogHeader>
        <MembersManager scope={scope} canManage={canManage} />
        {/* Per-project only: cast a real person to lend their likeness without
            joining the project (director casting invites). */}
        {scope.kind === "project" && <CastingManager projectId={scope.id} canManage={canManage} />}
      </DialogContent>
    </Dialog>
  );
}
