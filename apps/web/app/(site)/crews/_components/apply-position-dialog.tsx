"use client";

/**
 * ApplyPositionDialog — applicant-facing apply form.
 *
 * Five fields, all optional except message:
 *   - message              cover letter (required)
 *   - expectedCompensation display amount + currency
 *   - availableStartDate   when they can start
 *   - yearsExperience      relevant years
 *   - portfolioUrl         external link (Behance / LinkedIn / personal)
 *
 * The form is intentionally short — owners can already see the
 * applicant's internal profile + published works, so this dialog
 * captures the position-specific extras (not duplicating a full CV).
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useCurrentUser } from "@/src/hooks/use-user";
import { defaultCurrencyForCell } from "@/src/lib/region/cell";
import {
  CURRENCY_SYMBOLS,
  CrewApiError,
  useApplyToPosition,
  type ApplyInput,
  type CurrencyCode,
  type SalaryPeriod,
} from "@/app/(site)/crews/_hooks/use-crew";

const APPLY_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

const SALARY_PERIOD_OPTIONS: { value: SalaryPeriod; key: string }[] = [
  { value: "month", key: "salaryPeriodMonth" },
  { value: "episode", key: "salaryPeriodEpisode" },
  { value: "project", key: "salaryPeriodProject" },
];

interface ApplyPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  positionId: string;
  /** Display label shown in the dialog header. */
  positionLabel: string;
  /** Optional crew name for friendlier copy. */
  crewName?: string;
}

export function ApplyPositionDialog(props: ApplyPositionDialogProps) {
  const { user } = useCurrentUser();
  if (!props.open) return null;
  return (
    <ApplicationForm key={JSON.stringify([user?.id, props.crewId, props.positionId])} {...props} />
  );
}

function ApplicationForm({
  open,
  onOpenChange,
  crewId,
  positionId,
  positionLabel,
  crewName,
}: ApplyPositionDialogProps) {
  const t = useTranslations("workspace");
  const tCrew = useTranslations("crew");
  const tc = useTranslations("common");

  const [message, setMessage] = useState("");
  const [expectedAmount, setExpectedAmount] = useState<string>("");
  const [expectedCurrency, setExpectedCurrency] = useState<CurrencyCode>(defaultCurrencyForCell());
  const [expectedPeriod, setExpectedPeriod] = useState<SalaryPeriod | "">("");
  const [availableDate, setAvailableDate] = useState<string>("");
  const [yearsExperience, setYearsExperience] = useState<string>("");
  const [portfolioUrl, setPortfolioUrl] = useState<string>("");

  const apply = useApplyToPosition(crewId, positionId);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const currencyOptions = useMemo(() => ["USD", "CNY"] as const, []);
  const showCurrencyPicker = currencyOptions.length > 1;

  const messageTrimmed = message.trim();
  const parsedAmount = expectedAmount === "" ? null : Number(expectedAmount);
  const parsedExperience = yearsExperience === "" ? null : Number(yearsExperience);
  const amountValid =
    parsedAmount === null ||
    (Number.isFinite(parsedAmount) && parsedAmount >= 0 && parsedAmount <= 100_000_000);
  const experienceValid =
    parsedExperience === null ||
    (Number.isInteger(parsedExperience) && parsedExperience >= 0 && parsedExperience <= 80);
  const canSubmit = !submitting && messageTrimmed.length > 0 && amountValid && experienceValid;

  const handleSubmit = () => {
    if (!alive.current || pending.current || !canSubmit) return;
    pending.current = true;
    setSubmitting(true);
    const body: ApplyInput = {
      message: messageTrimmed,
      portfolioUrl: portfolioUrl.trim() || null,
      expectedCompensation:
        expectedAmount === ""
          ? null
          : {
              amount: parsedAmount,
              currency: expectedCurrency,
              period: expectedPeriod || null,
            },
      availableStartDate: availableDate || null,
      yearsExperience: parsedExperience,
    };
    apply.mutate(body, {
      onSuccess: () => {
        if (!alive.current) return;
        toast.success(tCrew("applySuccess"));
        onOpenChange(false);
      },
      onError: (err) => {
        if (!alive.current) return;
        if (err instanceof CrewApiError) {
          const detail =
            typeof err.body === "object" && err.body && "message" in err.body
              ? String((err.body as { message: unknown }).message)
              : err.message;
          toast.error(`HTTP ${err.status}`, { description: detail, duration: 8000 });
        } else {
          toast.error(err instanceof Error ? err.message : tCrew("applyFailed"));
        }
      },
      onSettled: () => {
        if (!alive.current) return;
        pending.current = false;
        setSubmitting(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={APPLY_HERO_URL}
          eyebrow={tCrew("plaza")}
          title={`${tCrew("applyNow")} · ${positionLabel}`}
          description={crewName ? `${crewName}` : undefined}
        />

        <DialogBody className="max-h-[60vh] overflow-y-auto">
          <FieldGroup>
            <Field>
              <FieldLabel required>{tCrew("applyMessagePlaceholder")}</FieldLabel>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={tCrew("applyMessagePlaceholder")}
                maxLength={1000}
                rows={4}
                disabled={submitting}
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t("applyExpectedSalaryLabel")}</FieldLabel>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100_000_000}
                    step="any"
                    aria-invalid={!amountValid}
                    value={expectedAmount}
                    onChange={(e) => setExpectedAmount(e.target.value)}
                    placeholder="8000"
                    disabled={submitting}
                    className="text-xs tabular-nums"
                  />
                  {!showCurrencyPicker ? (
                    <span className="text-xs text-muted-foreground">
                      {CURRENCY_SYMBOLS[expectedCurrency]}
                    </span>
                  ) : null}
                </div>
                {!amountValid && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("applyInvalidAmount")}
                  </p>
                )}
              </Field>
              <Field>
                <FieldLabel>{t("createJobSalaryPeriodLabel")}</FieldLabel>
                <Select
                  value={expectedPeriod}
                  onValueChange={(v) => setExpectedPeriod(v as SalaryPeriod)}
                  disabled={submitting}
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
              </Field>
            </div>

            {showCurrencyPicker ? (
              <Field>
                <FieldLabel>{t("salaryCurrency")}</FieldLabel>
                <Select
                  value={expectedCurrency}
                  onValueChange={(v) => setExpectedCurrency(v as CurrencyCode)}
                  disabled={submitting}
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
              </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t("applyYearsExperienceLabel")}</FieldLabel>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={80}
                  step={1}
                  aria-invalid={!experienceValid}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                  placeholder="3"
                  disabled={submitting}
                  className="text-xs tabular-nums"
                />
                {!experienceValid && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("applyInvalidExperience")}
                  </p>
                )}
              </Field>
            </div>

            <Field>
              <FieldLabel>{t("applyAvailableDateLabel")}</FieldLabel>
              <Input
                type="date"
                value={availableDate}
                onChange={(e) => setAvailableDate(e.target.value)}
                disabled={submitting}
              />
            </Field>

            <Field>
              <FieldLabel>{t("applyPortfolioLabel")}</FieldLabel>
              <Input
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                placeholder={t("applyPortfolioPlaceholder")}
                maxLength={512}
                disabled={submitting}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("applyPortfolioHint")}</p>
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
            {tCrew("applyNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
