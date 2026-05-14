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
import { IconClock, IconLoader2 } from "@tabler/icons-react";
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
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
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
  // Salary composite — feature-gated until backend ships the matching
  // fields on `/project/crew/job/create`. Kept as live state (rather
  // than stubbed) so the day the gate flips we just include these in
  // the mutate payload and drop the disabled prop.
  const [salaryPeriod, setSalaryPeriod] = useState<string>("month");
  const [salaryMin, setSalaryMin] = useState<string>("");
  const [salaryMax, setSalaryMax] = useState<string>("");
  const [salaryNegotiable, setSalaryNegotiable] = useState<boolean>(false);

  const { data: roles = [] } = useProjectRoles();
  const create = useCreateJob(crewId);
  const submitting = create.isPending;

  // Reset on close per DESIGN.md § "State reset on close".
  useEffect(() => {
    if (open) return;
    setRoleId("");
    setJobDescription("");
    setJobNumber("1");
    setSalaryPeriod("month");
    setSalaryMin("");
    setSalaryMax("");
    setSalaryNegotiable(false);
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

            {/* Salary composite — feature-gated. Whole field is opacity-
                halved + pointer-events-none so it reads as "preview, not
                live". When backend adds the four matching fields
                (salaryPeriod / salaryMin / salaryMax / salaryNegotiable),
                drop `salaryDisabled` and include them in the mutate
                payload — no other change needed. */}
            <Field
              data-disabled="true"
              className="pointer-events-none rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 opacity-60"
            >
              <FieldLabel className="flex items-center justify-between">
                <span>{t("createJobSalaryLabel")}</span>
                <span className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-inset ring-amber-500/30">
                  <IconClock className="size-2.5" />
                  {tc("comingSoon")}
                </span>
              </FieldLabel>

              <div className="space-y-2.5">
                {/* Pay period — 月薪 / 集酬 / 项目费 */}
                <Select value={salaryPeriod} onValueChange={setSalaryPeriod} disabled>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("createJobSalaryPeriodPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">{t("salaryPeriodMonth")}</SelectItem>
                    <SelectItem value="episode">{t("salaryPeriodEpisode")}</SelectItem>
                    <SelectItem value="project">{t("salaryPeriodProject")}</SelectItem>
                  </SelectContent>
                </Select>

                {/* Range — min ~ max, with currency suffix */}
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                    placeholder={t("createJobSalaryMinPlaceholder")}
                    disabled
                    className="flex-1 text-xs tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                    placeholder={t("createJobSalaryMaxPlaceholder")}
                    disabled
                    className="flex-1 text-xs tabular-nums"
                  />
                  <span className="w-12 shrink-0 text-center text-xs text-muted-foreground">
                    {t("salaryCurrencyCNY")}
                  </span>
                </div>

                {/* Negotiable toggle — when on, the backend will ignore
                    min/max and just persist "面议" semantics. */}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <div className="text-xs text-foreground">
                      {t("createJobSalaryNegotiableLabel")}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("createJobSalaryNegotiableHint")}
                    </div>
                  </div>
                  <SwitchControl value={salaryNegotiable} onChange={setSalaryNegotiable} disabled />
                </div>
              </div>
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
