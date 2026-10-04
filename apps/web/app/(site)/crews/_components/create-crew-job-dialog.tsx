"use client";
import { RequiredSkillsSelect } from "./required-skills-select";

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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconHelpCircle, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/src/hooks/use-user";
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

import { useCrewTask, useCrewTaskOptions } from "../_hooks/use-tasks";
import { useCrewPermissions } from "../_hooks/use-crew-permissions";

const CREATE_JOB_HERO_URL = "/crews/publish-position-hero.jpg";

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
  initialTaskId?: string;
  initialPositionType?: string;
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

export function CreateCrewJobDialog(props: PublishPositionDialogProps) {
  const { user } = useCurrentUser();
  if (!props.open) return null;
  return (
    <PositionForm
      key={JSON.stringify([user?.id, props.crewId, props.editingPosition?.id, props.initialTaskId])}
      {...props}
    />
  );
}

function PositionForm({
  open,
  onOpenChange,
  crewId,
  editingPosition,
  initialTaskId,
  initialPositionType,
}: PublishPositionDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const presetPositions = useTranslatedPresetPositions();
  const currencyOptions = useMemo(() => allowedCurrenciesForCell(), []);
  const showCurrencyPicker = currencyOptions.length > 1;
  const isEdit = editingPosition !== undefined;

  const permissions = useCrewPermissions(crewId);
  const canLinkTask = permissions.can("tasks.manage") && permissions.can("tasks.view");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [taskId, setTaskId] = useState(initialTaskId ?? "");
  const tasks = useCrewTaskOptions(crewId, { recruitmentOnly: true }, !isEdit && canLinkTask);
  useEffect(() => {
    if (
      initialTaskId &&
      !tasks.data.some((task) => task.id === initialTaskId) &&
      tasks.hasNextPage &&
      !tasks.isFetching &&
      !tasks.isError
    ) {
      void tasks.fetchNextPage();
    }
  }, [initialTaskId, tasks]);
  const taskValid =
    !taskId ||
    (canLinkTask &&
      !tasks.isError &&
      tasks.isSuccess &&
      tasks.data.some((task) => task.id === taskId));

  const sourceTask = useCrewTask(taskId, !isEdit && canLinkTask && taskValid && Boolean(taskId));

  const [step, setStep] = useState<StepId>(1);

  // ─── Step 1: Basic ──────────────────
  const [positionType, setPositionType] = useState<string>(
    editingPosition?.positionType ?? initialPositionType ?? ""
  );
  const [description, setDescription] = useState(editingPosition?.description ?? "");
  const [count, setCount] = useState<string>(String(editingPosition?.targetCount ?? 1));
  const [requiredSkills, setRequiredSkills] = useState<string[]>(
    editingPosition?.requiredSkills ?? []
  );

  // ─── Step 2: Employment ────────────
  const [workMode, setWorkMode] = useState<WorkMode>(editingPosition?.workMode ?? "remote");
  const [location, setLocation] = useState<string>(editingPosition?.location ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    editingPosition?.employmentType ?? "project_based"
  );
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(
    editingPosition?.experienceLevel ?? "any"
  );

  // ─── Step 3: Salary + Tenure + Lifecycle ────
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>(
    (editingPosition?.salary.period ?? "month") as SalaryPeriod
  );
  const [salaryCurrency, setSalaryCurrency] = useState<CurrencyCode>(
    (editingPosition?.salary.currency ?? defaultCurrencyForCell()) as CurrencyCode
  );
  const [salaryMin, setSalaryMin] = useState<string>(() => {
    const amount = editingPosition?.salary.minAmount;
    return amount == null
      ? ""
      : String(ZERO_DECIMAL_CURRENCIES.has(salaryCurrency) ? amount : amount / 100);
  });
  const [salaryMax, setSalaryMax] = useState<string>(() => {
    const amount = editingPosition?.salary.maxAmount;
    return amount == null
      ? ""
      : String(ZERO_DECIMAL_CURRENCIES.has(salaryCurrency) ? amount : amount / 100);
  });
  const [salaryNegotiable, setSalaryNegotiable] = useState<boolean>(
    editingPosition?.salary.negotiable ?? false
  );
  // Empty string means "long-term / open-ended" — the wire field
  // becomes NULL. Same convention for revenue share.
  const [durationMonths, setDurationMonths] = useState<string>(
    editingPosition?.durationMonths == null ? "" : String(editingPosition.durationMonths)
  );
  const [revenueSharePercent, setRevenueSharePercent] = useState<string>(
    editingPosition?.revenueSharePercent == null ? "" : String(editingPosition.revenueSharePercent)
  );
  const [closeDate, setCloseDate] = useState<string>(editingPosition?.closeDate ?? "");

  const create = useCreatePosition(crewId);
  const update = useUpdatePosition(crewId);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Pending-application banner: only relevant in edit mode, only when
  // the owner is about to change material terms. Fetched once per
  // dialog open via the standard hook (cache shared with the rest of
  // the workspace, no extra round trip in practice).
  const applications = useCrewApplications(crewId, isEdit, {
    positionId: editingPosition?.id,
  });
  const pendingApplicantCount = applications.summary?.pending ?? 0;

  const [importedTask, setImportedTask] = useState<string | null>(null);
  const taskToImport = sourceTask.data;
  if (
    !isEdit &&
    !sourceTask.isError &&
    taskToImport &&
    taskToImport.id === taskId &&
    importedTask !== taskId
  ) {
    setImportedTask(taskId);
    if (!positionType && taskToImport.positionRole) setPositionType(taskToImport.positionRole);
    setDescription((current) => (current.trim() ? current : taskToImport.description));
    setRequiredSkills((current) =>
      current.length ? current : (taskToImport.requiredSkills ?? [])
    );
    const amount = taskToImport.rewardUsdMinor;
    if (amount != null && !salaryMin && !salaryMax) {
      setSalaryCurrency("USD");
      setSalaryMin(String(amount / 100));
      setSalaryMax(String(amount / 100));
      setSalaryPeriod("project");
    }
    if (taskToImport.dueAt && !closeDate) setCloseDate(taskToImport.dueAt.slice(0, 10));
  }

  // ─── Per-step validation ──────────
  const parsedCount = Number(count);
  const parsedMin = salaryMin === "" ? null : Number(salaryMin);
  const parsedMax = salaryMax === "" ? null : Number(salaryMax);
  const parsedDuration = durationMonths === "" ? null : Number(durationMonths);
  const parsedShare = revenueSharePercent === "" ? null : Number.parseFloat(revenueSharePercent);
  const needsLocation = workMode !== "remote";
  const locationOk = !needsLocation || location.trim().length > 0;
  const salaryAmountsOk =
    salaryNegotiable ||
    [parsedMin, parsedMax].every(
      (amount) =>
        amount == null || (Number.isFinite(amount) && amount >= 0 && amount <= 100_000_000)
    );
  const salaryRangeOk =
    salaryNegotiable || parsedMin == null || parsedMax == null || parsedMax >= parsedMin;
  // Treat blank input as "leave unset"; only validate when the user
  // actually typed something. Server enforces the hard caps in zod.
  const durationOk =
    parsedDuration == null ||
    (Number.isInteger(parsedDuration) && parsedDuration >= 1 && parsedDuration <= 60);
  const shareOk =
    parsedShare == null ||
    (Number.isFinite(parsedShare) &&
      parsedShare >= 0.5 &&
      parsedShare <= 50 &&
      Math.round(parsedShare * 2) === parsedShare * 2);

  const countOk = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 99;
  const step1Valid =
    (visibility !== "private" || Boolean(taskId)) &&
    taskValid &&
    positionType.length > 0 &&
    description.trim().length > 0 &&
    description.trim().length <= 10000 &&
    countOk;
  const step2Valid = locationOk;
  const step3Valid = salaryAmountsOk && salaryRangeOk && durationOk && shareOk;

  const canAdvance =
    (step === 1 && step1Valid) || (step === 2 && step2Valid) || (step === 3 && step3Valid);

  // Whether a given step is reachable for back-navigation (any earlier
  // step or the current one). Future steps stay locked until you pass
  // through them.
  const stepReachable = (target: StepId): boolean => target <= step;

  // ─── Submit ────────────────────────
  // The immutable task link is sent only during creation.
  const buildBody = (): CreatePositionInput => ({
    ...(!isEdit && taskId ? { taskId, recruitmentVisibility: visibility } : {}),
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
    if (!alive.current) return;
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
    if (!alive.current || pending.current || !step1Valid || !step2Valid || !step3Valid) return;
    pending.current = true;
    setSubmitting(true);
    const onSettled = () => {
      if (!alive.current) return;
      pending.current = false;
      setSubmitting(false);
    };
    const body = buildBody();
    if (isEdit && editingPosition) {
      const patch: UpdatePositionInput & { positionId: string } = {
        ...body,
        positionId: editingPosition.id,
      };
      update.mutate(patch, {
        onSettled,
        onSuccess: () => {
          if (!alive.current) return;
          toast.success(t("editJobSuccess"));
          onOpenChange(false);
        },
        onError: (err) => surfaceError(err, "editJobFailed"),
      });
    } else {
      create.mutate(body, {
        onSettled,
        onSuccess: () => {
          if (!alive.current) return;
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
            onJump={(s) => !submitting && stepReachable(s) && setStep(s)}
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
                {!isEdit &&
                canLinkTask &&
                taskValid &&
                taskId &&
                sourceTask.isSuccess &&
                !sourceTask.isError &&
                sourceTask.data?.crewId === crewId &&
                sourceTask.data?.id === taskId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting || Boolean(description.trim())}
                    onClick={() => setDescription(sourceTask.data.description)}
                  >
                    {t("useTaskBrief")}
                  </Button>
                ) : null}
                <p className="text-xs text-muted-foreground">{t("publicBriefHelp")}</p>
                {description.trim().length > 10000 ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t("publicBriefTooLong")}
                  </p>
                ) : null}
                <Textarea
                  className="max-h-40 overflow-y-auto"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("createJobDescriptionPlaceholder")}
                  maxLength={10000}
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
                  step={1}
                  aria-invalid={!countOk}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  disabled={submitting}
                />
                {!countOk ? (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {t("createJobNumberError")}
                  </p>
                ) : null}
              </Field>

              <RequiredSkillsSelect
                value={requiredSkills}
                onChange={setRequiredSkills}
                disabled={submitting}
              />
              {!isEdit && (canLinkTask || taskId) ? (
                <Field>
                  <FieldLabel>{t("recruitmentTaskLabel")}</FieldLabel>
                  <Select
                    value={taskId || "none"}
                    onValueChange={(value) => {
                      setTaskId(value === "none" ? "" : value);
                      if (value === "none") setVisibility("public");
                    }}
                    disabled={submitting}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("recruitmentTaskNone")}</SelectItem>
                      {canLinkTask && !tasks.isError
                        ? tasks.data.map((task) => (
                            <SelectItem key={task.id} value={task.id}>
                              #{task.number} {task.title}
                            </SelectItem>
                          ))
                        : null}
                    </SelectContent>
                  </Select>
                  {taskId && (
                    <>
                      <FieldLabel>{t("recruitmentVisibility")}</FieldLabel>
                      <Select
                        value={visibility}
                        onValueChange={(value) => setVisibility(value as "public" | "private")}
                        disabled={submitting}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">{t("recruitmentPublic")}</SelectItem>
                          <SelectItem value="private">{t("recruitmentPrivate")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  <p className="text-sm text-muted-foreground">{t("recruitmentTaskHelp")}</p>
                  {tasks.isPending && canLinkTask ? <p role="status">{tc("loading")}</p> : null}
                  {tasks.isError || !taskValid ? (
                    <p role="alert">{t("recruitmentTaskUnavailable")}</p>
                  ) : null}
                  {canLinkTask ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={tasks.isFetching || submitting}
                      onClick={() => void tasks.refetch()}
                    >
                      {t("recruitmentTaskRefresh")}
                    </Button>
                  ) : null}
                </Field>
              ) : null}
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
                {!salaryAmountsOk ? (
                  <p role="alert" className="mt-1 text-xs text-rose-400">
                    {t("createJobSalaryAmountError")}
                  </p>
                ) : !salaryRangeOk ? (
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
                  aria-invalid={!durationOk}
                  step={1}
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(e.target.value)}
                  placeholder={t("createJobDurationPlaceholder")}
                  disabled={submitting}
                  className="tabular-nums"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("createJobDurationHint")}</p>
                {!durationOk ? (
                  <p role="alert" className="mt-1 text-xs text-destructive">
                    {t("createJobDurationError")}
                  </p>
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
          {step !== 1 && !taskValid ? (
            <p role="alert" className="text-sm text-destructive">
              {t("recruitmentTaskUnavailable")}
            </p>
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
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!step1Valid || !step2Valid || !step3Valid || submitting}
            >
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
