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
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
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
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";
import { CURRENT_CELL } from "@/src/lib/region/cell";
import { useTranslatedPresetPositions } from "@/app/(site)/crews/_hooks/use-position-label";
import {
  ALL_CURRENCIES,
  CURRENCY_SYMBOLS,
  CrewApiError,
  useCreatePosition,
  type CreatePositionInput,
  type CurrencyCode,
  type EmploymentType,
  type ExperienceLevel,
  type SalaryPeriod,
  type WorkMode,
} from "@/app/(site)/crews/_hooks/use-crew";

const CREATE_JOB_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

interface PublishPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
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
];

const SALARY_PERIOD_OPTIONS: { value: SalaryPeriod; key: string }[] = [
  { value: "month", key: "salaryPeriodMonth" },
  { value: "episode", key: "salaryPeriodEpisode" },
  { value: "project", key: "salaryPeriodProject" },
];

function allowedCurrenciesForCell(): readonly CurrencyCode[] {
  if (CURRENT_CELL === "cn") return ["CNY"];
  return ALL_CURRENCIES;
}

function defaultCurrencyForCell(): CurrencyCode {
  return CURRENT_CELL === "cn" ? "CNY" : "USD";
}

export function CreateCrewJobDialog({ open, onOpenChange, crewId }: PublishPositionDialogProps) {
  const t = useTranslations("workspace");
  const tc = useTranslations("common");
  const presetPositions = useTranslatedPresetPositions();
  const currencyOptions = useMemo(() => allowedCurrenciesForCell(), []);
  const showCurrencyPicker = currencyOptions.length > 1;

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

  // ─── Step 3: Salary + Lifecycle ────
  const [salaryPeriod, setSalaryPeriod] = useState<SalaryPeriod>("month");
  const [salaryCurrency, setSalaryCurrency] = useState<CurrencyCode>(defaultCurrencyForCell());
  const [salaryMin, setSalaryMin] = useState<string>("");
  const [salaryMax, setSalaryMax] = useState<string>("");
  const [salaryNegotiable, setSalaryNegotiable] = useState<boolean>(false);
  const [closeDate, setCloseDate] = useState<string>("");

  const create = useCreatePosition(crewId);
  const submitting = create.isPending;

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
    setCloseDate("");
  }, [open]);

  // ─── Per-step validation ──────────
  const parsedCount = Number.parseInt(count, 10);
  const parsedMin = salaryMin === "" ? null : Number.parseFloat(salaryMin);
  const parsedMax = salaryMax === "" ? null : Number.parseFloat(salaryMax);
  const needsLocation = workMode !== "remote";
  const locationOk = !needsLocation || location.trim().length > 0;
  const salaryRangeOk =
    salaryNegotiable || parsedMin == null || parsedMax == null || parsedMax >= parsedMin;

  const step1Valid =
    positionType.length > 0 &&
    description.trim().length > 0 &&
    Number.isFinite(parsedCount) &&
    parsedCount >= 1 &&
    parsedCount <= 99;
  const step2Valid = locationOk;
  const step3Valid = salaryRangeOk;

  const canAdvance =
    (step === 1 && step1Valid) || (step === 2 && step2Valid) || (step === 3 && step3Valid);

  // Whether a given step is reachable for back-navigation (any earlier
  // step or the current one). Future steps stay locked until you pass
  // through them.
  const stepReachable = (target: StepId): boolean => target <= step;

  // ─── Submit ────────────────────────
  const handleSubmit = () => {
    if (!step3Valid || submitting) return;
    const body: CreatePositionInput = {
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
      closeDate: closeDate || null,
    };
    create.mutate(body, {
      onSuccess: () => {
        toast.success(t("createJobSuccess"));
        onOpenChange(false);
      },
      onError: (err) => {
        if (err instanceof CrewApiError) {
          const detail =
            typeof err.body === "object" && err.body && "message" in err.body
              ? String((err.body as { message: unknown }).message)
              : err.message;
          toast.error(`HTTP ${err.status}`, { description: detail, duration: 10000 });
        } else {
          toast.error(err instanceof Error ? err.message : t("createJobFailed"));
        }
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogHero
          src={CREATE_JOB_HERO_URL}
          eyebrow={t("createJobDialogEyebrow")}
          title={t("createJobDialogTitle")}
          description={t(`createJobStep${step}Title`)}
        />

        <DialogBody className="max-h-[60vh] overflow-y-auto">
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
                  <FieldLabel>{t("createJobExperienceLabel")}</FieldLabel>
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
              {submitting ? t("createJobSubmitting") : t("createJobSubmit")}
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
