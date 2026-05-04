"use client";

import { useEffect, useState } from "react";
import { IconLoader2, IconMail, IconAlertCircle } from "@tabler/icons-react";
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
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "@/src/i18n/i18n";
import { MEMBER_ROLE, useProjectRoles } from "@/app/(site)/ips/_hooks/use-ip";

const TEAM_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 team banner.png"
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewMember {
  email: string;
  role: number;
  remark: string;
}

interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onSubmit: (member: NewMember) => void | Promise<void>;
}

export function AddMemberDialog({ open, onOpenChange, busy, onSubmit }: AddMemberDialogProps) {
  const t = useTranslations("ipEdit");
  const tc = useTranslations("common");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [remark, setRemark] = useState("");

  const rolesQuery = useProjectRoles(open);
  const roles = rolesQuery.data ?? [];

  // Default the role to the legacy MEMBER value when present, else first.
  useEffect(() => {
    if (!open) return;
    if (role) return;
    if (roles.length === 0) return;
    const member = roles.find((r) => r.id === MEMBER_ROLE.MEMBER);
    setRole(String((member ?? roles[0]).id));
  }, [open, role, roles]);

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setRole("");
    setRemark("");
  }, [open]);

  const trimmedEmail = email.trim();
  const isValidEmail = EMAIL_RE.test(trimmedEmail);
  const showInvalidHint = trimmedEmail.length > 0 && !isValidEmail;
  const canSubmit = isValidEmail && !!role && !busy;

  const handleSubmit = async () => {
    if (!isValidEmail) return;
    await onSubmit({
      email: trimmedEmail,
      role: Number(role),
      remark: remark.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={TEAM_HERO_URL}
          eyebrow={t("teamHeroEyebrow")}
          title={t("addMemberTitle")}
          description={t("teamHeroSubtitle")}
        />

        <DialogBody className="py-4">
          <div className="space-y-4">
            <Field>
              <FieldLabel>{t("memberEmail")}</FieldLabel>
              <FieldDescription>{t("memberEmailDesc")}</FieldDescription>
              <div className="relative">
                <IconMail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="pl-9"
                  autoFocus
                />
              </div>
              {showInvalidHint && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconAlertCircle className="size-3.5" />
                  {t("memberLookupInvalid")}
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel>{t("memberRole")}</FieldLabel>
              <FieldDescription>{t("memberRoleDesc")}</FieldDescription>
              <Select
                value={role}
                onValueChange={setRole}
                disabled={rolesQuery.isLoading || roles.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      rolesQuery.isLoading ? t("memberRoleLoading") : t("memberRolePlaceholder")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rolesQuery.isError && (
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-destructive">
                  <IconAlertCircle className="size-3.5" />
                  {t("memberRoleFailed")}
                </p>
              )}
            </Field>

            <Field>
              <FieldLabel>{t("memberRemark")}</FieldLabel>
              <FieldDescription>{t("memberRemarkDesc")}</FieldDescription>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("memberRemarkPlaceholder")}
                rows={3}
              />
            </Field>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="outline"
            color="muted"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {tc("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? <IconLoader2 className="size-3.5 animate-spin" /> : null}
            {t("addMemberConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
