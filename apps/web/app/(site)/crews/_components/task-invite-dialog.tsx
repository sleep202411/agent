"use client";
import { useState } from "react";
import { IconLink } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { useCrewPermissions } from "../_hooks/use-crew-permissions";
import type { CrewTaskListItemDTO } from "../_hooks/types";
import { InviteLinkPanel } from "./invite-link-panel";

export function TaskInviteDialog({
  task,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  task: CrewTaskListItemDTO;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const t = useTranslations("workspace");
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const { can } = useCrewPermissions(task.crewId);
  if (
    !can("members.invite") ||
    !can("tasks.manage") ||
    task.assignees.length ||
    task.isRecruiting ||
    ["approved", "cancelled", "submitted"].includes(task.status)
  )
    return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <IconLink className="size-4" />
            {t("taskInviteTitle")}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="max-h-[85dvh] overflow-hidden sm:max-w-lg"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("taskInviteTitle")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="min-w-0">
          <InviteLinkPanel crewId={task.crewId} open={open} canGrantPolicies={false} task={task} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
