"use client";

/**
 * Create-job (publish-role) dialog. Phase-1 spec entry — opens from
 * the crew workspace "Recruitment" tab "+ Publish Job" button.
 * Visual conventions match `<CreateIPDialog>` per DESIGN.md
 * § "Create dialog conventions".
 *
 * Fields (per phase-1 spec):
 *   - 岗位名称 (role) — required, dropdown from `useProjectRoles`
 *     (preset roles served by `/project/role/list`)
 *   - 岗位描述 (jobDescription) — required textarea
 *   - 招聘人数 (jobNumber) — required, ≥ 1
 *
 * The wire payload sends both `roleId` (the chosen id) and `jobName`
 * (the chosen role's display label) — see CreateJobInput TODO for why
 * both today.
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
import { useCreateJob } from "@/app/(site)/crews/_hooks/use-jobs";
import { useProjectRoles } from "@/app/(site)/crews/_hooks/use-projects";

const CREATE_JOB_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

interface CreateCrewJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
}

export function CreateCrewJobDialog({ open, onOpenChange, crewId }: CreateCrewJobDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");

  const [roleId, setRoleId] = useState<string>("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobNumber, setJobNumber] = useState<string>("1");

  const { data: roles = [] } = useProjectRoles();
  const create = useCreateJob(crewId);
  const submitting = create.isPending;

  // Reset on close per DESIGN.md § "State reset on close".
  useEffect(() => {
    if (open) return;
    setRoleId("");
    setJobDescription("");
    setJobNumber("1");
  }, [open]);

  const selectedRole = useMemo(() => roles.find((r) => String(r.id) === roleId), [roles, roleId]);
  const parsedNumber = Number.parseInt(jobNumber, 10);
  const canSubmit =
    !submitting &&
    roleId.length > 0 &&
    jobDescription.trim().length > 0 &&
    Number.isFinite(parsedNumber) &&
    parsedNumber >= 1;

  const handleSubmit = () => {
    if (!canSubmit || !selectedRole) return;
    create.mutate(
      {
        crewId,
        roleId: selectedRole.id,
        // Use the role's display name as `jobName` so the wire payload
        // is self-describing even before backend confirms whether
        // `jobName` should be denormalized server-side.
        jobName: selectedRole.name,
        jobDescription: jobDescription.trim(),
        jobNumber: parsedNumber,
      },
      {
        onSuccess: () => {
          toast.success(t("createJobSuccess"));
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError) {
            toast.error(`HTTP ${err.status}`, {
              description: err.responseBody?.slice(0, 1000) || err.message,
              duration: 10000,
            });
          } else {
            const msg = err instanceof Error ? err.message : "";
            toast.error(msg || t("createJobFailed"), { duration: 10000 });
          }
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={CREATE_JOB_HERO_URL}
          eyebrow={t("createJobDialogEyebrow")}
          title={t("createJobDialogTitle")}
          description={t("createJobDialogSubtitle")}
        />

        <DialogBody>
          <FieldGroup>
            <Field>
              <FieldLabel required>{t("createJobRoleLabel")}</FieldLabel>
              <Select value={roleId} onValueChange={setRoleId} disabled={submitting}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("createJobRolePlaceholder")} />
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
              <FieldLabel required>{t("createJobDescriptionLabel")}</FieldLabel>
              <Textarea
                className="max-h-40 overflow-y-auto"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder={t("createJobDescriptionPlaceholder")}
                maxLength={500}
                rows={4}
                disabled={submitting}
              />
            </Field>

            <Field>
              <FieldLabel required>{t("createJobNumberLabel")}</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                placeholder={t("createJobNumberPlaceholder")}
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
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {submitting ? t("createJobSubmitting") : t("createJobSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
