"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconChevronRight,
  IconCircleCheck,
  IconMovie,
  IconFileText,
  IconUsers,
  IconCalendar,
  IconCurrencyDollar,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

const PROJECT_TYPES = [
  "ebook",
  "basicAIDrama",
  "premiumAIDrama",
  "webMovie",
  "filmTV",
  "basicAd",
  "premiumAd",
  "digitalHuman",
] as const;

const PHASES = [
  "preProduction",
  "storyboarding",
  "videoGeneration",
  "voiceMusic",
  "roughCut",
  "fineCut",
  "postProduction",
  "releasePrep",
] as const;

const ALL_ROLES = [
  "director",
  "screenwriter",
  "storyboarder",
  "aiArt",
  "characterDesign",
  "sceneDesign",
  "voiceActor",
  "musicProducer",
  "editor",
  "colorist",
  "mixingEngineer",
  "subtitleCreator",
  "postProd",
  "asstProducer",
] as const;

interface FormData {
  name: string;
  ipName: string;
  projectType: string;
  description: string;
  deadline: string;
  budgetRange: string;
  startPhase: string;
  roles: string[];
  rolesCount: Record<string, number>;
}

const STEPS = [
  { step: 1, labelKey: "csStepBasic" },
  { step: 2, labelKey: "csStepRoles" },
  { step: 3, labelKey: "csStepConfirm" },
] as const;

export default function CreateCrewPage() {
  const t = useTranslations("crewCreate");
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<FormData>({
    name: "",
    ipName: "",
    projectType: "",
    description: "",
    deadline: "",
    budgetRange: "",
    startPhase: "preProduction",
    roles: [],
    rolesCount: {},
  });

  const update = useCallback((patch: Partial<FormData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleRole = (role: string) => {
    update({
      roles: form.roles.includes(role)
        ? form.roles.filter((r) => r !== role)
        : [...form.roles, role],
    });
  };

  const setRoleCount = (role: string, count: number) => {
    update({ rolesCount: { ...form.rolesCount, [role]: count } });
  };

  const canProceed = step === 1 ? form.name.trim().length > 0 && form.projectType.length > 0 : true;

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="flex size-16 items-center justify-center rounded-full bg-green-400/10">
          <IconCircleCheck className="size-8 text-green-400" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-foreground">{t("csSuccessTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("csSuccessDesc")}</p>
        <div className="mt-8 flex items-center gap-3">
          <Link
            href="/crews"
            className="rounded-xl border border-border bg-secondary px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            {t("csBackToHall")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-screen-2xl px-6 py-4">
          <Link
            href="/crews"
            className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            {t("csBack")}
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <IconMovie className="size-5 text-primary" />
            {t("csTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("csSubtitle")}</p>
        </div>
      </div>

      {/* Progress */}
      <div className="mx-auto max-w-2xl px-6 pt-8">
        <div className="mb-8 flex items-center gap-2">
          {STEPS.map(({ step: s, labelKey }) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-sm font-medium",
                  step >= s
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {step > s ? <IconCircleCheck className="size-4" /> : s}
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  step >= s ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {t(labelKey)}
              </span>
              {s < 3 && (
                <div className="h-px flex-1 bg-border">
                  <div
                    className={cn(
                      "h-full transition-all",
                      step > s ? "bg-primary" : "bg-transparent"
                    )}
                    style={{ width: step > s ? "100%" : "0%" }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 pb-12">
        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                <IconFileText className="mr-1 inline size-4" />
                {t("csName")} <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={t("csNamePlaceholder")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t("csIPName")}
              </label>
              <input
                type="text"
                value={form.ipName}
                onChange={(e) => update({ ipName: e.target.value })}
                placeholder={t("csIPNamePlaceholder")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-3 block text-sm font-medium text-foreground">
                {t("csProjectType")} <span className="text-destructive">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {PROJECT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => update({ projectType: type })}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      form.projectType === type
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    )}
                  >
                    {t(`csType_${type}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                <IconFileText className="mr-1 inline size-4" />
                {t("csDescription")}
              </label>
              <textarea
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder={t("csDescPlaceholder")}
                rows={4}
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <IconCalendar className="mr-1 inline size-4" />
                  {t("csDeadline")}
                </label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => update({ deadline: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <IconCurrencyDollar className="mr-1 inline size-4" />
                  {t("csBudgetRange")}
                </label>
                <input
                  type="text"
                  value={form.budgetRange}
                  onChange={(e) => update({ budgetRange: e.target.value })}
                  placeholder={t("csBudgetPlaceholder")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Phases & Roles */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="mb-3 block text-sm font-medium text-foreground">
                {t("csStartPhase")}
              </label>
              <div className="flex flex-wrap gap-2">
                {PHASES.map((phase) => (
                  <button
                    key={phase}
                    type="button"
                    onClick={() => update({ startPhase: phase })}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      form.startPhase === phase
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    )}
                  >
                    {t(`csPhase_${phase}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-3 block text-sm font-medium text-foreground">
                <IconUsers className="mr-1 inline size-4" />
                {t("csRecruitRoles")}
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      form.roles.includes(role)
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    )}
                  >
                    {t(`csRole_${role}`)}
                  </button>
                ))}
              </div>
            </div>
            {form.roles.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t("csHeadcount")}</h3>
                <div className="space-y-2">
                  {form.roles.map((role) => (
                    <div key={role} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t(`csRole_${role}`)}</span>
                      <input
                        type="number"
                        min={1}
                        value={form.rolesCount[role] || 1}
                        onChange={(e) => setRoleCount(role, parseInt(e.target.value) || 1)}
                        className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 text-sm font-semibold text-foreground">{t("csSummary")}</h3>
              <div className="space-y-3 text-xs text-muted-foreground">
                {[
                  { labelKey: "csName", value: form.name },
                  { labelKey: "csIPName", value: form.ipName },
                  {
                    labelKey: "csProjectType",
                    value: form.projectType ? t(`csType_${form.projectType}`) : "",
                  },
                  { labelKey: "csStartPhase", value: t(`csPhase_${form.startPhase}`) },
                  { labelKey: "csDeadline", value: form.deadline },
                  { labelKey: "csBudgetRange", value: form.budgetRange },
                  {
                    labelKey: "csRecruitRoles",
                    value: form.roles.map((r) => t(`csRole_${r}`)).join("、"),
                  },
                ].map(({ labelKey, value }) => (
                  <div key={labelKey} className="flex justify-between">
                    <span>{t(labelKey)}</span>
                    <span className="font-medium text-foreground">{value || t("csNotSet")}</span>
                  </div>
                ))}
                {form.roles.length > 0 && (
                  <div className="border-t border-border pt-2">
                    <div className="mb-2 text-xs text-muted-foreground">{t("csHeadcount")}：</div>
                    {form.roles.map((role) => (
                      <div key={role} className="flex justify-between">
                        <span>{t(`csRole_${role}`)}</span>
                        <span className="font-medium text-foreground">
                          {form.rolesCount[role] || 1} {t("csPeople")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {form.description && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">{t("csDescription")}</h3>
                <p className="text-xs text-muted-foreground">{form.description}</p>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("csPrev")}
            </button>
          ) : (
            <div />
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canProceed}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("csNext")} <IconChevronRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSubmitted(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconMovie className="size-4" /> {t("csCreate")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
