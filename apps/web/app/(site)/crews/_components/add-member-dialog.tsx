"use client";

/**
 * Add-member dialog. Phase-1 spec entry — opens from the crew workspace
 * "Members" tab "+ Add Member" button. Visually mirrors
 * `<CreateIPDialog>` per DESIGN.md § "Create dialog conventions".
 *
 * Fields:
 *   - 手机号 / 邮箱 (contact, required) — single text input; backend
 *     auto-detects which one the user typed
 *   - 角色 (role, required) — Select populated from `useProjectRoles`
 *     (the same `/project/role/list` taxonomy the crew listing uses)
 *   - 备注 (remark, optional)
 *
 * Endpoint contract is best-guess (see `useAddCrewMember` TODO).
 * When backend lands, only the hook needs updating; this dialog
 * keeps the same { contact, role, remark } shape.
 */

import { useEffect, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiRequestError } from "@/src/lib/api";
import { useAddCrewMember } from "@/app/(site)/crews/_hooks/use-crew";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";

// Hero image — matches `<CreateCrewDialog>` so the two crew dialogs
// feel like one product. Replace per-feature when product gives a
// member-specific illustration.
const ADD_MEMBER_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

interface AddCrewMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
}

export function AddCrewMemberDialog({ open, onOpenChange, crewId }: AddCrewMemberDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");

  const [contact, setContact] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [remark, setRemark] = useState("");

  const { data: roles = [] } = useProjectRoles();
  const { mutateAsync: addMember, isPending: submitting } = useAddCrewMember(crewId);

  // Reset on close per DESIGN.md § "State reset on close".
  useEffect(() => {
    if (open) return;
    setContact("");
    setRoleId("");
    setRemark("");
  }, [open]);

  const canSubmit = !submitting && contact.trim().length > 0 && roleId.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await addMember({
        crewId,
        contact: contact.trim(),
        role: Number(roleId),
        remark: remark.trim() || undefined,
      });
      toast.success(t("addMemberSuccess"));
      onOpenChange(false);
    } catch (err) {
      // Surface the raw backend response per DESIGN.md § "Error toasts".
      if (err instanceof ApiRequestError) {
        toast.error(`HTTP ${err.status}`, {
          description: err.responseBody?.slice(0, 1000) || err.message,
          duration: 10000,
        });
      } else {
        const msg = err instanceof Error ? err.message : "";
        toast.error(msg || t("addMemberFailed"), { duration: 10000 });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={ADD_MEMBER_HERO_URL}
          eyebrow={t("addMemberDialogEyebrow")}
          title={t("addMemberDialogTitle")}
          description={t("addMemberDialogSubtitle")}
        />

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("addMemberContactLabel")}</FieldLabel>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t("addMemberContactPlaceholder")}
                maxLength={120}
                disabled={submitting}
                autoFocus
              />
            </Field>

            <Field>
              <FieldLabel required>{t("addMemberRoleLabel")}</FieldLabel>
              <Select value={roleId} onValueChange={setRoleId} disabled={submitting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("addMemberRolePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>{t("addMemberRemarkLabel")}</FieldLabel>
              <Textarea
                className="max-h-32 overflow-y-auto"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("addMemberRemarkPlaceholder")}
                maxLength={200}
                rows={2}
                disabled={submitting}
              />
            </Field>
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {submitting ? t("addMemberSubmitting") : t("addMemberSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
