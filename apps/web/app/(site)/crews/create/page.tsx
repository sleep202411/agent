"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconCalendar,
  IconChevronRight,
  IconCircleCheck,
  IconCurrencyDollar,
  IconFileText,
  IconLoader2,
  IconMovie,
  IconUsers,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { useCreateCrew, type CreateCrewInput } from "@/app/(site)/crews/_hooks/use-crew";

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

interface FormState {
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

const EMPTY_FORM: FormState = {
  name: "",
  ipName: "",
  projectType: "",
  description: "",
  deadline: "",
  budgetRange: "",
  startPhase: "preProduction",
  roles: [],
  rolesCount: {},
};

const STEPS = [
  { step: 1, labelKey: "csStepBasic" },
  { step: 2, labelKey: "csStepRoles" },
  { step: 3, labelKey: "csStepConfirm" },
] as const;

export default function CreateCrewPage() {
  const t = useTranslations("crewCreate");
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { mutate: createCrew, isPending: submitting } = useCreateCrew();

  const update = useCallback((patch: Partial<FormState>) => {
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

  const handleSubmit = () => {
    const payload: CreateCrewInput = {
      name: form.name.trim(),
      ipName: form.ipName.trim() || undefined,
      description: form.description.trim() || undefined,
      projectType: form.projectType,
      deadline: form.deadline || undefined,
      budgetRange: form.budgetRange.trim() || undefined,
      startPhase: form.startPhase,
      roles: form.roles.map((name) => ({ name, count: form.rolesCount[name] || 1 })),
    };
    createCrew(payload, {
      onSuccess: ({ id }) => {
        toast.success(t("csSuccessTitle"));
        router.push(`/crews/${id}`);
      },
      onError: () => toast.error(t("csCreate")),
    });
  };

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
            <Field>
              <FieldLabel>
                <IconFileText className="mr-1 inline size-4" />
                {t("csName")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                value={form.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder={t("csNamePlaceholder")}
              />
            </Field>

            <Field>
              <FieldLabel>{t("csIPName")}</FieldLabel>
              <Input
                value={form.ipName}
                onChange={(e) => update({ ipName: e.target.value })}
                placeholder={t("csIPNamePlaceholder")}
              />
            </Field>

            <Field>
              <FieldLabel>
                {t("csProjectType")} <span className="text-destructive">*</span>
              </FieldLabel>
              <ChipGroup
                items={PROJECT_TYPES.map((id) => ({ id, label: t(`csType_${id}`) }))}
                selected={form.projectType}
                onSelect={(id) => update({ projectType: id })}
              />
            </Field>

            <Field>
              <FieldLabel>
                <IconFileText className="mr-1 inline size-4" />
                {t("csDescription")}
              </FieldLabel>
              <Textarea
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder={t("csDescPlaceholder")}
                rows={4}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>
                  <IconCalendar className="mr-1 inline size-4" />
                  {t("csDeadline")}
                </FieldLabel>
                <Input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => update({ deadline: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel>
                  <IconCurrencyDollar className="mr-1 inline size-4" />
                  {t("csBudgetRange")}
                </FieldLabel>
                <Input
                  value={form.budgetRange}
                  onChange={(e) => update({ budgetRange: e.target.value })}
                  placeholder={t("csBudgetPlaceholder")}
                />
              </Field>
            </div>
          </div>
        )}

        {/* Step 2: Phases & Roles */}
        {step === 2 && (
          <div className="space-y-6">
            <Field>
              <FieldLabel>{t("csStartPhase")}</FieldLabel>
              <ChipGroup
                items={PHASES.map((id) => ({ id, label: t(`csPhase_${id}`) }))}
                selected={form.startPhase}
                onSelect={(id) => update({ startPhase: id })}
              />
            </Field>

            <Field>
              <FieldLabel>
                <IconUsers className="mr-1 inline size-4" />
                {t("csRecruitRoles")}
              </FieldLabel>
              <ChipGroup
                multi
                items={ALL_ROLES.map((id) => ({ id, label: t(`csRole_${id}`) }))}
                selectedSet={form.roles}
                onToggle={toggleRole}
              />
            </Field>

            {form.roles.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium text-foreground">{t("csHeadcount")}</h3>
                <div className="space-y-2">
                  {form.roles.map((role) => (
                    <div key={role} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t(`csRole_${role}`)}</span>
                      <Input
                        type="number"
                        min={1}
                        value={form.rolesCount[role] || 1}
                        onChange={(e) => setRoleCount(role, parseInt(e.target.value) || 1)}
                        className="w-20 text-center"
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
                    <FieldDescription className="mb-2">{t("csHeadcount")}：</FieldDescription>
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
            <Button variant="ghost" color="muted" onClick={() => setStep((s) => s - 1)}>
              {t("csPrev")}
            </Button>
          ) : (
            <div />
          )}
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>
              {t("csNext")} <IconChevronRight className="size-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconMovie className="size-4" />
              )}
              {t("csCreate")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────

interface ChipGroupProps {
  items: { id: string; label: string }[];
  /** Single-select mode. */
  selected?: string;
  onSelect?: (id: string) => void;
  /** Multi-select mode. */
  multi?: boolean;
  selectedSet?: string[];
  onToggle?: (id: string) => void;
}

function ChipGroup({ items, selected, onSelect, multi, selectedSet, onToggle }: ChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = multi ? (selectedSet ?? []).includes(item.id) : selected === item.id;
        return (
          <Button
            key={item.id}
            type="button"
            variant={active ? "soft" : "outline"}
            color={active ? "primary" : "muted"}
            size="sm"
            onClick={() => (multi ? onToggle?.(item.id) : onSelect?.(item.id))}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}
