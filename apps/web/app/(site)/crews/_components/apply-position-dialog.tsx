"use client";

/**
 * ApplyPositionDialog — applicant-facing apply form.
 *
 * Five fields, all optional except message:
 *   - message              cover letter (required)
 *   - expectedSalary       yuan (server converts to 分)
 *   - availableStartDate   when they can start
 *   - yearsExperience      relevant years
 *   - portfolioUrl         external link (Behance / LinkedIn / personal)
 *
 * The form is intentionally short — owners can already see the
 * applicant's internal profile + published works, so this dialog
 * captures the position-specific extras (not duplicating a full CV).
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
  CrewApiError,
  useApplyToPosition,
  type ApplyInput,
} from "@/app/(site)/crews/_hooks/use-crew";

const APPLY_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

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

export function ApplyPositionDialog({
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
  const [expectedSalary, setExpectedSalary] = useState<string>("");
  const [availableDate, setAvailableDate] = useState<string>("");
  const [yearsExperience, setYearsExperience] = useState<string>("");
  const [portfolioUrl, setPortfolioUrl] = useState<string>("");

  const apply = useApplyToPosition(crewId, positionId);
  const submitting = apply.isPending;

  useEffect(() => {
    if (open) return;
    setMessage("");
    setExpectedSalary("");
    setAvailableDate("");
    setYearsExperience("");
    setPortfolioUrl("");
  }, [open]);

  const messageTrimmed = message.trim();
  const canSubmit = !submitting && messageTrimmed.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const body: ApplyInput = {
      message: messageTrimmed,
      portfolioUrl: portfolioUrl.trim() || null,
      expectedSalary: expectedSalary === "" ? null : Number.parseInt(expectedSalary, 10),
      availableStartDate: availableDate || null,
      yearsExperience: yearsExperience === "" ? null : Number.parseInt(yearsExperience, 10),
    };
    apply.mutate(body, {
      onSuccess: () => {
        toast.success(tCrew("applySuccess"));
        onOpenChange(false);
      },
      onError: (err) => {
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
                    inputMode="numeric"
                    min={0}
                    value={expectedSalary}
                    onChange={(e) => setExpectedSalary(e.target.value)}
                    placeholder="8000"
                    disabled={submitting}
                    className="text-xs tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">{t("salaryCurrencyCNY")}</span>
                </div>
              </Field>
              <Field>
                <FieldLabel>{t("applyYearsExperienceLabel")}</FieldLabel>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={80}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(e.target.value)}
                  placeholder="3"
                  disabled={submitting}
                  className="text-xs tabular-nums"
                />
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
