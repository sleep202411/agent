import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { IconArrowLeft, IconArrowRight, IconRocket } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { backendApi } from "@/src/lib/api";

interface ProjectCategory {
  value: string;
  label: string;
}

const PROJECT_CATEGORIES: ProjectCategory[] = [
  { value: "1", label: "IP Development" },
  { value: "2", label: "Series" },
  { value: "3", label: "Brand Short" },
  { value: "4", label: "Commercial" },
  { value: "5", label: "Creative Experiment" },
];

const TOTAL_STEPS = 3;

export default function CreateIPPage() {
  const t = useTranslations("ipCreate");
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canProceed = () => {
    switch (step) {
      case 0:
        return name.trim().length > 0;
      case 1:
        return typeId !== "";
      case 2:
        return true; // description is optional
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await backendApi.post<{ id?: number }>("/project/create", {
        data: {
          name: name.trim(),
          typeId: Number(typeId),
          description: description.trim() || undefined,
        },
      });
      const projectId = (result as { id?: number })?.id;
      if (projectId) {
        toast.success(t("createSuccess"));
        void navigate({ to: "/ips/$id/edit", params: { id: String(projectId) } });
      } else {
        toast.error(t("createFailed"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      void handleSubmit();
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      {/* Step indicator */}
      <div className="border-b border-border">
        <div className="px-8 py-3">
          <span className="text-xs text-muted-foreground">
            {t("stepIndicator", { current: step + 1, total: TOTAL_STEPS })}
          </span>
        </div>
      </div>

      {/* Step content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {step === 0 && (
          <div className="w-full max-w-xl text-center">
            <h2 className="text-2xl font-bold text-foreground">{t("step1Heading")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("step1Subheading")}</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("titlePlaceholder")}
              maxLength={50}
              autoFocus
              className="mt-10 w-full rounded-lg border border-border bg-secondary/50 px-4 py-3 text-center text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
            />
          </div>
        )}

        {step === 1 && (
          <div className="w-full max-w-xl text-center">
            <h2 className="text-2xl font-bold text-foreground">{t("step2Heading")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("step2Subheading")}</p>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              autoFocus
              className="mt-10 w-full appearance-none rounded-lg border border-border bg-secondary/50 px-4 py-3 text-center text-sm text-foreground outline-none transition-colors focus:border-primary"
            >
              <option value="" disabled>
                {t("selectCategory")}
              </option>
              {PROJECT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {step === 2 && (
          <div className="w-full max-w-xl text-center">
            <h2 className="text-2xl font-bold text-foreground">{t("step3Heading")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("step3Subheading")}</p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descPlaceholder")}
              maxLength={500}
              rows={4}
              autoFocus
              className="mt-10 w-full resize-none rounded-lg border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
            />
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="border-t border-border">
        <div className="flex items-center justify-between px-8 py-4">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <IconArrowLeft className="size-4" />
              {t("prev")}
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={!canProceed() || submitting}
            className="flex items-center gap-1.5 rounded-xl bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
          >
            {step < TOTAL_STEPS - 1 ? (
              <>
                {t("next")}
                <IconArrowRight className="size-4" />
              </>
            ) : (
              <>
                <IconRocket className="size-4" />
                {submitting ? t("creating") : t("createAndContinue")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
