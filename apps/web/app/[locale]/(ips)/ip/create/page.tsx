import { useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconClipboard,
  IconBook,
  IconCurrencyDollar,
  IconGift,
  IconRocket,
  IconArrowLeft,
  IconArrowRight,
  IconCircleCheck,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { createEmptyIPForm, type IPCreateForm } from "@/components/ip/ip-mock";
import { StepBasicInfo } from "@/components/ip/create-ip/step-basic-info";
import { StepStory } from "@/components/ip/create-ip/step-story";
import { StepFunding } from "@/components/ip/create-ip/step-funding";
import { StepRewards } from "@/components/ip/create-ip/step-rewards";
import { StepPreview } from "@/components/ip/create-ip/step-preview";

const STEPS = [
  { icon: IconClipboard, labelKey: "stepBasicInfo" },
  { icon: IconBook, labelKey: "stepStory" },
  { icon: IconCurrencyDollar, labelKey: "stepFunding" },
  { icon: IconGift, labelKey: "stepRewards" },
  { icon: IconRocket, labelKey: "stepPreview" },
] as const;

function canProceed(step: number, form: IPCreateForm) {
  switch (step) {
    case 0:
      return !!form.title && !!form.projectType && !!form.description;
    case 1:
      return form.story.length >= 30 && !!form.whyThisIP;
    case 2:
      return form.fundingMode === "investment"
        ? !!form.valuation && !!form.sharesOffered && !!form.totalShares
        : form.presalePrice > 0 && form.presaleTarget > 0;
    case 3:
      return form.rewards.length > 0;
    case 4:
      return true;
    default:
      return false;
  }
}

export default function CreateIPPage() {
  const t = useTranslations("ipCreate");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<IPCreateForm>(createEmptyIPForm);
  const [submitted, setSubmitted] = useState(false);

  const updateForm = useCallback((patch: Partial<IPCreateForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSubmit = () => {
    // TODO: POST /api/ip
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-green-400/10">
          <IconCircleCheck className="size-8 text-green-400" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-foreground">{t("successTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("successDesc")}</p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            to="/projects"
            className="rounded-xl border border-border bg-secondary px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            {t("goToWorkbench")}
          </Link>
          <Link
            to="/ips"
            className="rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("viewIPPlaza")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            to="/ips"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            {t("backToPlaza")}
          </Link>
          <h1 className="text-sm font-bold text-foreground">{t("pageTitle")}</h1>
          <div className="w-16" />
        </div>
      </div>

      {/* Step indicators */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <button
                key={s.labelKey}
                type="button"
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                className={cn(
                  "flex items-center gap-2 text-xs font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : isDone
                      ? "cursor-pointer text-foreground"
                      : "cursor-default text-muted-foreground/50"
                )}
              >
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border transition-all",
                    isActive
                      ? "border-primary bg-primary/10"
                      : isDone
                        ? "border-green-400/40 bg-green-400/10"
                        : "border-border bg-secondary"
                  )}
                >
                  {isDone ? (
                    <IconCircleCheck className="size-4 text-green-400" />
                  ) : (
                    <Icon
                      className={cn(
                        "size-4",
                        isActive ? "text-primary" : "text-muted-foreground/50"
                      )}
                    />
                  )}
                </div>
                <span className="hidden sm:inline">{t(s.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto max-w-3xl px-6 py-8">
        {step === 0 && <StepBasicInfo form={form} update={updateForm} />}
        {step === 1 && <StepStory form={form} update={updateForm} />}
        {step === 2 && <StepFunding form={form} update={updateForm} />}
        {step === 3 && <StepRewards form={form} update={updateForm} />}
        {step === 4 && <StepPreview form={form} />}
      </div>

      {/* Footer nav */}
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-30"
          >
            <IconArrowLeft className="size-4" /> {t("prev")}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed(step, form)}
              className="flex items-center gap-1 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {t("next")} <IconArrowRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                !canProceed(0, form) ||
                !canProceed(1, form) ||
                !canProceed(2, form) ||
                !canProceed(3, form)
              }
              className="flex items-center gap-1 rounded-xl bg-green-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-500/90 disabled:opacity-50"
            >
              <IconRocket className="size-4" /> {t("submitPublish")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
