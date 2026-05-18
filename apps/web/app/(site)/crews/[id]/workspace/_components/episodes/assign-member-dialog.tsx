"use client";

/**
 * Per-episode "assign a crew member" picker. The user picks an active
 * crew member from the roster and a role label from the preset list;
 * the assignment is submitted with that label as `roleName` (no
 * `positionId` — episode assignments are not tied to recruitment
 * positions, even when the crew member joined through one).
 */

import { useEffect, useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCrewMembers } from "@/app/(site)/crews/_hooks/use-crew";
import {
  useTranslatePositionValue,
  useTranslatedPresetPositions,
} from "@/app/(site)/crews/_hooks/use-position-label";
import { useAssignMember, type EpisodeAssignment } from "@/app/(site)/crews/_hooks/use-episodes";

interface AssignMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  episodeId: string;
  episodeNumber: number;
  /** Existing assignments so already-assigned crew members are hidden
   *  from the picker (each user can only have one slot per episode). */
  existingAssignments: EpisodeAssignment[];
}

export function AssignMemberDialog({
  open,
  onOpenChange,
  crewId,
  episodeId,
  episodeNumber,
  existingAssignments,
}: AssignMemberDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const translatePosition = useTranslatePositionValue();
  const presetPositions = useTranslatedPresetPositions();

  const [userId, setUserId] = useState<string>("");
  const [roleValue, setRoleValue] = useState<string>("");

  const { data: crewMembers = [] } = useCrewMembers(crewId);
  const assign = useAssignMember(crewId, episodeId);
  const submitting = assign.isPending;

  useEffect(() => {
    if (open) return;
    setUserId("");
    setRoleValue("");
  }, [open]);

  const assignedUserIds = useMemo(
    () => new Set(existingAssignments.map((a) => a.userId)),
    [existingAssignments]
  );
  const availableMembers = useMemo(
    () => crewMembers.filter((m) => !assignedUserIds.has(m.userId)),
    [crewMembers, assignedUserIds]
  );

  const canSubmit = !submitting && userId.length > 0 && roleValue.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const roleName = translatePosition(roleValue);
    assign.mutate(
      { userId, roleName },
      {
        onSuccess: () => {
          toast.success(t("assignMemberSuccess"));
          onOpenChange(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : t("assignMemberFailed")),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("assignMemberTitle", { number: episodeNumber })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("assignMember")}</FieldLabel>
              {availableMembers.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  {t("noMembersAvailable")}
                </div>
              ) : (
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("assignMemberPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMembers.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        User {m.userId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field>
              <FieldLabel required>{t("assignmentRole")}</FieldLabel>
              <Select value={roleValue} onValueChange={setRoleValue}>
                <SelectTrigger>
                  <SelectValue placeholder={t("assignmentRolePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {presetPositions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {tc("cancel")}
          </Button>
          <Button variant="solid" color="primary" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("assignMemberConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
