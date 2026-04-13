import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { IconArrowLeft, IconArrowRight, IconRocket } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { backendApi } from "@/src/lib/api";
import { getCategories } from "@/src/lib/api/ip-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const TOTAL_STEPS = 3;

export default function CreateIPPage() {
  const t = useTranslations("ipCreate");
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    void getCategories().then((cats) => {
      setCategoryOptions(Object.entries(cats).map(([v, l]) => ({ value: v, label: l })));
    });
  }, []);

  const canProceed = () => {
    switch (step) {
      case 0:
        return name.trim().length > 0;
      case 1:
        return typeId !== "";
      case 2:
        return true;
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("titlePlaceholder")}
              maxLength={50}
              autoFocus
              className="mt-10 h-12 text-center"
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
              className="mt-10 h-12 w-full appearance-none rounded-md border border-input bg-input/20 px-4 text-center text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
            >
              <option value="" disabled>
                {t("selectCategory")}
              </option>
              {categoryOptions.map((c) => (
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
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("descPlaceholder")}
              maxLength={500}
              rows={4}
              autoFocus
              className="mt-10 min-h-28"
            />
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="border-t border-border">
        <div className="flex items-center justify-between px-8 py-4">
          {step > 0 ? (
            <Button variant="ghost" color="muted" onClick={() => setStep((s) => s - 1)}>
              <IconArrowLeft className="size-4" />
              {t("prev")}
            </Button>
          ) : (
            <div />
          )}

          <Button onClick={handleNext} disabled={!canProceed() || submitting}>
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
          </Button>
        </div>
      </div>
    </div>
  );
}
