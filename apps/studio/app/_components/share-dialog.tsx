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
import { StoryProjectRolePermissionTable } from "./story-project-role-permission-table";

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
  const isStory = scope.kind === "story-project";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isStory
            ? "flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col overflow-hidden p-5 sm:max-w-4xl sm:p-6"
            : "flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col sm:max-w-md"
        }
      >
        <DialogHeader className="min-w-0 shrink-0 break-words pr-7">
          <DialogTitle>{t("share.title", { name: scope.name })}</DialogTitle>
          <DialogDescription>
            {scope.kind === "workspace"
              ? t("share.descriptionWorkspace")
              : scope.kind === "story-project"
                ? t("share.descriptionStoryProject")
                : t("share.descriptionProject")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-1">
          <MembersManager
            scope={scope}
            canManage={canManage}
            renderRoleGuide={
              isStory
                ? (role, source) => (
                    <StoryProjectRolePermissionTable selectedRole={role} source={source} />
                  )
                : undefined
            }
          />
          {/* Per-project only: cast a real person to lend their likeness without
            joining the project (director casting invites). */}
          {scope.kind === "project" && (
            <CastingManager projectId={scope.id} canManage={canManage} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
