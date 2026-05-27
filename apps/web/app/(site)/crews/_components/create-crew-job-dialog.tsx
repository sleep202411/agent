"use client";

/**
 * Publish-position dialog — 3-step wizard.
 *
 *   Step 1 · Basic info  — preset role + description + headcount + skills
 *   Step 2 · Employment  — work mode + city / type / level
 *   Step 3 · Compensation — salary (currency-aware) + auto-archive date
 *
 * Per-step validation gates the "Next" button; final step shows
 * "Publish". The stepper at the top of the body doubles as visual
 * progress + quick jump back to a completed step.
 *
 * Currency picker is cell-aware (cn → CNY only / no picker; com →
 * full whitelist, defaults to USD).
 */

import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconHelpCircle, IconLoader2 } from "@tabler/icons-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SwitchControl } from "@/components/ui/schema-field/switch-control";
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";
import { allowedCurrenciesForCell, defaultCurrencyForCell } from "@/src/lib/region/cell";
import { useTranslatedPresetPositions } from "@/app/(site)/crews/_hooks/use-position-label";
import {
  CURRENCY_SYMBOLS,
  CrewApiError,
  ZERO_DECIMAL_CURRENCIES,
  useCreatePosition,
  useCrewApplications,
  useUpdatePosition,
  type CreatePositionInput,
  type CrewPositionDTO,
  type CurrencyCode,
  type EmploymentType,
  type ExperienceLevel,
  type SalaryPeriod,
  type UpdatePositionInput,
  type WorkMode,
} from "@/app/(site)/crews/_hooks/use-crew";

const CREATE_JOB_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

interface PublishPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  /**
   * When supplied, the dialog switches to **edit mode**: form prefills
   * from the existing position, title says "edit", submit invokes
   * `useUpdatePosition` instead of `useCreatePosition`. Undefined
   * means create mode (original behaviour).
   */
  editingPosition?: CrewPositionDTO;
}

type StepId = 1 | 2 | 3;

const WORK_MODE_OPTIONS: { value: WorkMode; key: string }[] = [
  { value: "remote", key: "workModeRemote" },
  { value: "hybrid", key: "workModeHybrid" },
  { value: "onsite", key: "workModeOnsite" },
];

const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; key: string }[] = [
  { value: "project_based", key: "employmentProjectBased" },
  { value: "freelance", key: "employmentFreelance" },
  { value: "contract", key: "employmentContract" },
  { value: "part_time", key: "employmentPartTime" },
  { value: "full_time", key: "employmentFullTime" },
];

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; key: string }[] = [
  { value: "any", key: "experienceAny" },
  { value: "junior", key: "experienceJunior" },
  { value: "mid", key: "experienceMid" },
  { value: "senior", key: "experienceSenior" },
  { value: "lead", key: "experienceLead" },
  { value: "master", key: "experienceMaster" },
];

const SALARY_PERIOD_OPTIONS: { value: SalaryPeriod; key: string }[] = [
  { value: "month", key: "salaryPeriodMonth" },
  { value: "episode", key: "salaryPeriodEpisode" },
  { value: "project", key: "salaryPeriodProject" },
];

export function CreateCrewJobDialog({
  open,
  onOpenChange,
  crewId,
  editingPosition,
}: PublishPositionDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const presetPositions = useTranslatedPresetPositions();
  const currencyOptions = useMemo(() => allowedCurrenciesForCell(), []);
  const showCurrencyPicker = currencyOptions.length > 1;
  const isEdit = editingPosition !== undefined;

  const [step, setStep] = useState<StepId>(1);

  // ─── Step 1: Basic ──────────────────
  const [positionType, setPositionType] = useState<string>("");
  const [description, setDescription] = useState("");
  const [count, setCount] = useState<string>("1");
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);

  // ─── Step 2: Employment ────────────
  const [workMode, setWorkMode] = useState<WorkMode>("remote");
  const [location, setLocation] = useState<string>("");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("project_based");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>("any");

  // ─── Step 3: Salary + Tenure + Lifecycle ────
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>("month");
  const [salaryCurrency, setSalaryCurrency] = useState<CurrencyCode>(defaultCurrencyForCell());
  const [salaryMin, setSalaryMin] = useState<string>("");
  const [salaryMax, setSalaryMax] = useState<string>("");
  const [salaryNegotiable, setSalaryNegotiable] = useState<boolean>(false);
  // Empty string means "long-term / open-ended" — the wire field
  // becomes NULL. Same convention for revenue share.
  const [durationMonths, setDurationMonths] = useState<string>("");
  const [revenueSharePercent, setRevenueSharePercent] = useState<string>("");
  const [closeDate, setCloseDate] = useState<string>("");

  const create = useCreatePosition(crewId);
  const update = useUpdatePosition(crewId);
  const submitting = create.isPending || update.isPending;

  // Pending-application banner: only relevant in edit mode, only when
  // the owner is about to change material terms. Fetched once per
  // dialog open via the standard hook (cache shared with the rest of
  // the workspace, no extra round trip in practice).
  const { data: allApplications = [] } = useCrewApplications(crewId, isEdit);
  const pendingApplicantCount = useMemo(() => {
    if (!editingPosition) return 0;
    return allApplications.filter(
      (a) => a.positionId === editingPosition.id && a.status === "pending"
    ).length;
  }, [allApplications, editingPosition]);

  // Reset form whenever the dialog is closed OR the editingPosition
  // identity changes (covers "open dialog from position A → close
  // without saving → re-open from position B" so state doesn't leak).
  useEffect(() => {
    if (open) return;
    setStep(1);
    setPositionType("");
    setDescription("");
    setCount("1");
    setRequiredSkills([]);
    setWorkMode("remote");
    setLocation("");
    setEmploymentType("project_based");
    setExperienceLevel("any");
    setSalaryPeriod("month");
    setSalaryCurrency(defaultCurrencyForCell());
    setSalaryMin("");
    setSalaryMax("");
    setSalaryNegotiable(false);
    setDurationMonths("");
    setRevenueSharePercent("");
    setCloseDate("");
  }, [open]);

  // Prefill from `editingPosition` when entering edit mode. Runs on
  // dialog open + when the underlying position identity changes
  // (rare, but harmless re-fill). Salary amounts are stored as
  // smallest-currency-unit on the wire; divide by 100 for display
  // unless the currency is zero-decimal (JPY etc) where the integer
  // IS the displayed value.
  useEffect(() => {
    if (!open || !editingPosition) return;
    const p = editingPosition;
    setPositionType(p.positionType);
    setDescription(p.description);
    setCount(String(p.targetCount));
    setRequiredSkills(p.requiredSkills);
    setWorkMode(p.workMode);
    setLocation(p.location ?? "");
    setEmploymentType(p.employmentType);
    setExperienceLevel(p.experienceLevel);
    setSalaryPeriod((p.salary.period ?? "month") as SalaryPeriod);
    const ccy = (p.salary.currency ?? defaultCurrencyForCell()) as CurrencyCode;
    setSalaryCurrency(ccy);
    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(ccy);
    setSalaryMin(
      p.salary.minAmount != null
        ? String(isZeroDecimal ? p.salary.minAmount : p.salary.minAmount / 100)
        : ""
    );
    setSalaryMax(
      p.salary.maxAmount != null
        ? String(isZeroDecimal ? p.salary.maxAmount : p.salary.maxAmount / 100)
        : ""
    );
    setSalaryNegotiable(p.salary.negotiable);
    setDurationMonths(p.durationMonths != null ? String(p.durationMonths) : "");
    setRevenueSharePercent(p.revenueSharePercent != null ? String(p.revenueSharePercent) : "");
    setCloseDate(p.closeDate ?? "");
    setStep(1);
  }, [open, editingPosition]);

  // ─── Per-step validation ──────────
  const parsedCount = Number.parseInt(count, 10);
  const parsedMin = salaryMin === "" ? null : Number.parseFloat(salaryMin);
  const parsedMax = salaryMax === "" ? null : Number.parseFloat(salaryMax);
  const parsedDuration = durationMonths === "" ? null : Number.parseInt(durationMonths, 10);
  const parsedShare = revenueSharePercent === "" ? null : Number.parseFloat(revenueSharePercent);
  const needsLocation = workMode !== "remote";
  const locationOk = !needsLocation || location.trim().length > 0;
  const salaryRangeOk =
    salaryNegotiable || parsedMin == null || parsedMax == null || parsedMax >= parsedMin;
  // Treat blank input as "leave unset"; only validate when the user
  // actually typed something. Server enforces the hard caps in zod.
  const durationOk =
    parsedDuration == null ||
    (Number.isFinite(parsedDuration) && parsedDuration >= 1 && parsedDuration <= 60);
  const shareOk =
    parsedShare == null ||
    (Number.isFinite(parsedShare) &&
      parsedShare >= 0.5 &&
      parsedShare <= 50 &&
      Math.round(parsedShare * 2) === parsedShare * 2);

  const step1Valid =
    positionType.length > 0 &&
    description.trim().length > 0 &&
    Number.isFinite(parsedCount) &&
    parsedCount >= 1 &&
    parsedCount <= 99;
  const step2Valid = locationOk;
  const step3Valid = salaryRangeOk && durationOk && shareOk;

  const canAdvance =
    (step === 1 && step1Valid) || (step === 2 && step2Valid) || (step === 3 && step3Valid);

  // Whether a given step is reachable for back-navigation (any earlier
  // step or the current one). Future steps stay locked until you pass
  // through them.
  const stepReachable = (target: StepId): boolean => target <= step;

  // ─── Submit ────────────────────────
  // Body builder is shared — both create and update accept the same
  // shape; update's zod schema is a `Partial<>` of the create schema.
  const buildBody = (): CreatePositionInput => ({
    positionType,
    description: description.trim(),
    targetCount: parsedCount,
    workMode,
    location: needsLocation ? location.trim() : null,
    employmentType,
    experienceLevel,
    requiredSkills,
    salary: salaryNegotiable
      ? { negotiable: true, period: null, currency: null, min: null, max: null }
      : {
          period: salaryPeriod,
          currency: parsedMin != null || parsedMax != null ? salaryCurrency : null,
          min: parsedMin,
          max: parsedMax,
          negotiable: false,
        },
    durationMonths: parsedDuration,
    revenueSharePercent: parsedShare,
    closeDate: closeDate || null,
  });

  const surfaceError = (err: unknown, fallbackKey: string) => {
    if (err instanceof CrewApiError) {
      const detail =
        typeof err.body === "object" && err.body && "message" in err.body
          ? String((err.body as { message: unknown }).message)
          : err.message;
      toast.error(`HTTP ${err.status}`, { description: detail, duration: 10000 });
    } else {
      toast.error(err instanceof Error ? err.message : t(fallbackKey));
    }
  };

  const handleSubmit = () => {
    if (!step3Valid || submitting) return;
    const body = buildBody();
    if (isEdit && editingPosition) {
      const patch: UpdatePositionInput & { positionId: string } = {
        ...body,
        positionId: editingPosition.id,
      };
      update.mutate(patch, {
        onSuccess: () => {
          toast.success(t("editJobSuccess"));
          onOpenChange(false);
        },
        onError: (err) => surfaceError(err, "editJobFailed"),
      });
    } else {
      create.mutate(body, {
        onSuccess: () => {
          toast.success(t("createJobSuccess"));
          onOpenChange(false);
        },
        onError: (err) => surfaceError(err, "createJobFailed"),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogHero
          src={CREATE_JOB_HERO_URL}
          eyebrow={isEdit ? t("editJobDialogEyebrow") : t("createJobDialogEyebrow")}
          title={isEdit ? t("editJobDialogTitle") : t("createJobDialogTitle")}
          description={t(`createJobStep${step}Title`)}
        />

        <DialogBody className="max-h-[60vh] overflow-y-auto">
          {/* Pending-applicant warning. Only render in edit mode, and
              only when at least one applicant is in flight. Material
              term changes (salary / duration / share) carry the
              clearest fairness risk; rather than gate edits per-field
              we surface a single banner the owner has to read past. */}
          {isEdit && pendingApplicantCount > 0 ? (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {t("editJobHasApplicantsWarn", { count: pendingApplicantCount })}
            </div>
          ) : null}

          <Stepper
            step={step}
            onJump={(s) => stepReachable(s) && setStep(s)}
            labels={[t("createJobStep1Label"), t("createJobStep2Label"), t("createJobStep3Label")]}
          />

          {/* ─── Step 1 ─── */}
          {step === 1 ? (
            <FieldGroup>
              <Field>
                <FieldLabel required>{t("createJobRoleLabel")}</FieldLabel>
                <Select value={positionType} onValueChange={setPositionType} disabled={submitting}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("createJobRolePlaceholder")} />
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

              <Field>
                <FieldLabel required>{t("createJobDescriptionLabel")}</FieldLabel>
                <Textarea
                  className="max-h-40 overflow-y-auto"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("createJobDescriptionPlaceholder")}
                  maxLength={1000}
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
                  max={99}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  disabled={submitting}
                />
              </Field>

              <Field>
                <FieldLabel>{t("createJobRequiredSkillsLabel")}</FieldLabel>
                <TagInput
                  value={requiredSkills}
                  onChange={setRequiredSkills}
                  placeholder={t("createJobSkillsPlaceholder")}
                  maxTags={20}
                  maxLength={64}
                  disabled={submitting}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("createJobSkillsHint")}</p>
              </Field>
            </FieldGroup>
          ) : null}

          {/* ─── Step 2 ─── */}
          {step === 2 ? (
            <FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>{t("createJobWorkModeLabel")}</FieldLabel>
                  <Select
                    value={workMode}
                    onValueChange={(v) => setWorkMode(v as WorkMode)}
                    disabled={submitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_MODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel required={needsLocation}>{t("createJobLocationLabel")}</FieldLabel>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={t("createJobLocationPlaceholder")}
                    maxLength={128}
                    disabled={submitting || !needsLocation}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>{t("createJobEmploymentTypeLabel")}</FieldLabel>
                  <Select
                    value={employmentType}
                    onValueChange={(v) => setEmploymentType(v as EmploymentType)}
                    disabled={submitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel className="flex items-center gap-1.5">
                    {t("createJobExperienceLabel")}
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("createJobExperienceHelpAria")}
                            className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <IconHelpCircle className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                          {t("createJobExperienceHelp")}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </FieldLabel>
                  <Select
                    value={experienceLevel}
                    onValueChange={(v) => setExperienceLevel(v as ExperienceLevel)}
                    disabled={submitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPERIENCE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>
          ) : null}

          {/* ─── Step 3 ─── */}
          {step === 3 ? (
            <FieldGroup>
              <Field>
                <FieldLabel>{t("createJobSalaryPeriodLabel")}</FieldLabel>
                <div className={showCurrencyPicker ? "grid grid-cols-2 gap-2" : ""}>
                  <Select
                    value={salaryPeriod}
                    onValueChange={(v) => setSalaryPeriod(v as SalaryPeriod)}
                    disabled={submitting || salaryNegotiable}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("createJobSalaryPeriodPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {SALARY_PERIOD_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showCurrencyPicker ? (
                    <Select
                      value={salaryCurrency}
                      onValueChange={(v) => setSalaryCurrency(v as CurrencyCode)}
                      disabled={submitting || salaryNegotiable}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currencyOptions.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CURRENCY_SYMBOLS[c]} {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </Field>

              <Field>
                <FieldLabel>{t("createJobSalaryRangeLabel")}</FieldLabel>
                {/* Same `grid grid-cols-2 gap-2` shape as the period row
                    above so the two inputs sit exactly under the two
                    selects. Trailing currency symbol dropped — the
                    selected currency is already visible in the dropdown
                    one row up; repeating it here was redundant and
                    misaligned the inputs. */}
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                    placeholder={t("createJobSalaryMinPlaceholder")}
                    disabled={submitting || salaryNegotiable}
                    className="tabular-nums"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                    placeholder={t("createJobSalaryMaxPlaceholder")}
                    disabled={submitting || salaryNegotiable}
                    className="tabular-nums"
                  />
                </div>
                {!salaryRangeOk ? (
                  <p className="mt-1 text-xs text-rose-400">{t("createJobSalaryRangeError")}</p>
                ) : null}
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-foreground">
                      {t("createJobSalaryNegotiableLabel")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("createJobSalaryNegotiableHint")}
                    </div>
                  </div>
                  <SwitchControl
                    value={salaryNegotiable}
                    onChange={setSalaryNegotiable}
                    disabled={submitting}
                  />
                </div>
              </Field>

              <Field>
                <FieldLabel>{t("createJobDurationLabel")}</FieldLabel>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  step={1}
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                  placeholder={t("createJobDurationPlaceholder")}
                  disabled={submitting}
                  className="tabular-nums"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("createJobDurationHint")}</p>
                {!durationOk ? (
                  <p className="mt-1 text-xs text-rose-400">{t("createJobDurationError")}</p>
                ) : null}
              </Field>

              <Field>
                <FieldLabel>{t("createJobRevenueShareLabel")}</FieldLabel>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={revenueSharePercent}
                  onChange={(e) => setRevenueSharePercent(e.target.value)}
                  placeholder={t("createJobRevenueSharePlaceholder")}
                  disabled={submitting}
                  className="tabular-nums"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("createJobRevenueShareHint")}
                </p>
                {!shareOk ? (
                  <p className="mt-1 text-xs text-rose-400">{t("createJobRevenueShareError")}</p>
                ) : null}
              </Field>

              <Field>
                <FieldLabel>{t("createJobCloseDateLabel")}</FieldLabel>
                <Input
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  disabled={submitting}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("createJobCloseDateHint")}</p>
              </Field>
            </FieldGroup>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => (step > 1 ? setStep((step - 1) as StepId) : onOpenChange(false))}
            disabled={submitting}
          >
            {step > 1 ? t("createJobBack") : tc("cancel")}
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => canAdvance && setStep((step + 1) as StepId)}
              disabled={!canAdvance || submitting}
            >
              {t("createJobNext")}
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={!step3Valid || submitting}>
              {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {submitting
                ? isEdit
                  ? t("editJobSubmitting")
                  : t("createJobSubmitting")
                : isEdit
                  ? t("editJobSubmit")
                  : t("createJobSubmit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Horizontal 3-step progress indicator. Numbered dots + labels;
 *  completed steps show a check mark, current step is filled. */
function Stepper({
  step,
  labels,
  onJump,
}: {
  step: StepId;
  labels: [string, string, string];
  onJump: (s: StepId) => void;
}) {
  return (
    <ol className="mb-5 flex items-center gap-2">
      {labels.map((label, i) => {
        const id = (i + 1) as StepId;
        const done = id < step;
        const active = id === step;
        const reachable = id <= step;
        return (
          <li key={id} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJump(id)}
              disabled={!reachable}
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                done
                  ? "border-primary bg-primary text-primary-foreground"
                  : active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary text-muted-foreground",
                reachable ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed opacity-50"
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <IconCheck className="size-3.5" /> : id}
            </button>
            <span
              className={cn(
                "truncate text-xs",
                active ? "font-semibold text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
            {i < labels.length - 1 ? (
              <span
                className={cn("ml-1 h-px flex-1", done ? "bg-primary/60" : "bg-border")}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
