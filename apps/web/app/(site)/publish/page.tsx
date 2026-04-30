"use client";

/**
 * Personal-video publish wizard. Native port of the personal-video
 * branch of fizzdragon-web's `pages/publicVideo/publicVideoPC.vue`.
 * Team-video publishing is intentionally out of scope.
 *
 * Two-step flow:
 *   1. Basic info — title / tags / description. On Next we either
 *      `createPersonalVideo` (first time) or `updatePersonalVideo`
 *      (returning), bound to a stable `personalId`.
 *   2. Upload — video file (multipart) + optional cover. Publish is
 *      a toast + back-navigation; the record is already in the DB
 *      because step 1 created it.
 *
 * Pre-condition: real-name verified. Otherwise a blocking dialog
 * routes to /kyc.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconArrowLeft, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { cn } from "@/lib/utils";
import { BasicInfoForm, type BasicInfoFormValue } from "./_components/basic-info-form";
import { VideoUploadStep } from "./_components/video-upload-step";
import {
  useCreatePersonalVideo,
  useTagList,
  useUpdatePersonalVideo,
  useUploadPersonalCover,
  useUploadPersonalVideoFile,
} from "./_hooks/use-publish";

type Step = "basic" | "upload";

const INITIAL_FORM: BasicInfoFormValue = { title: "", description: "", tagIds: [] };

export default function PublishPage() {
  const t = useTranslations("publishVideo");
  const router = useRouter();
  const locale = useLocale() as Locale;

  const [step, setStep] = useState<Step>("basic");
  const [form, setForm] = useState<BasicInfoFormValue>(INITIAL_FORM);
  const [personalId, setPersonalId] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>(undefined);

  const { data: tags = [] } = useTagList();

  const createMut = useCreatePersonalVideo();
  const updateMut = useUpdatePersonalVideo();
  const uploadVideoMut = useUploadPersonalVideoFile();
  const uploadCoverMut = useUploadPersonalCover();

  const isBasicValid = useMemo(
    () => Boolean(form.title.trim() && form.description.trim() && form.tagIds.length > 0),
    [form]
  );

  // Reset to step 1 if user pulls a hard refresh mid-flow.
  useEffect(() => {
    setStep("basic");
  }, []);

  const goBackToProfile = () => {
    router.replace(localizePath("/profile", locale));
  };

  const handleNext = async () => {
    if (!isBasicValid) {
      toast.warning(t("pleaseCompleteInfo"));
      return;
    }
    try {
      if (personalId == null) {
        const res = await createMut.mutateAsync({
          title: form.title.trim(),
          introduction: form.description.trim(),
          tags: form.tagIds,
          viewStatus: 1,
        });
        setPersonalId(res.id);
      } else {
        await updateMut.mutateAsync({
          id: personalId,
          title: form.title.trim(),
          introduction: form.description.trim(),
          viewStatus: 1,
        });
      }
      setStep("upload");
    } catch {
      toast.error(personalId == null ? t("createFailed") : t("updateFailed"));
    }
  };

  const handleUploadVideo = async (file: File) => {
    if (personalId == null) return;
    try {
      await uploadVideoMut.mutateAsync({ personalId, file });
      // For local preview, point at the picked File; backend playback
      // URL becomes available once the publish completes.
      setVideoUrl(URL.createObjectURL(file));
      toast.success(t("uploadSuccess"));
    } catch {
      toast.error(t("uploadFailed"));
    }
  };

  const handleUploadCover = async (file: File) => {
    if (personalId == null) return;
    try {
      await uploadCoverMut.mutateAsync({ personalId, file });
      toast.success(t("uploadSuccess"));
    } catch {
      toast.error(t("uploadFailed"));
    }
  };

  const handlePublish = () => {
    if (!videoUrl) {
      toast.warning(t("pleaseUploadVideo"));
      return;
    }
    toast.success(t("publishSuccess"));
    setTimeout(goBackToProfile, 1200);
  };

  // Step config keeps the sidebar render simple.
  const steps: { key: Step; label: string }[] = [
    { key: "basic", label: t("stepBasic") },
    { key: "upload", label: t("stepUpload") },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-10">
      <header className="mb-8 flex items-center gap-3">
        <button
          type="button"
          onClick={goBackToProfile}
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          aria-label="back"
        >
          <IconArrowLeft className="size-5" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("pageTitle")}</h1>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        {/* Step rail */}
        <aside>
          <ol className="space-y-1">
            {steps.map((s, i) => {
              const active = i === stepIndex;
              const done = i < stepIndex;
              return (
                <li
                  key={s.key}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
                    active
                      ? "bg-primary/10 text-foreground"
                      : done
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      active
                        ? "bg-primary text-primary-foreground"
                        : done
                          ? "bg-primary/20 text-primary"
                          : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {done ? <IconCheck className="size-3.5" /> : i + 1}
                  </span>
                  {s.label}
                </li>
              );
            })}
          </ol>
        </aside>

        {/* Step content */}
        <section className="rounded-2xl border border-border bg-card/40 p-6 sm:p-8">
          {step === "basic" ? (
            <BasicInfoForm value={form} onChange={setForm} tags={tags} />
          ) : (
            <VideoUploadStep
              videoUrl={videoUrl}
              uploading={uploadVideoMut.isPending}
              onPickVideo={handleUploadVideo}
              onPickCover={handleUploadCover}
              coverUploading={uploadCoverMut.isPending}
            />
          )}

          {/* Footer actions */}
          <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
            {step === "basic" ? (
              <>
                <Button variant="outline" onClick={goBackToProfile} disabled={submitting}>
                  {t("cancel")}
                </Button>
                <Button onClick={handleNext} disabled={!isBasicValid || submitting}>
                  {submitting ? (
                    <>
                      <IconLoader2 className="size-4 animate-spin" />
                      {personalId != null ? t("updating") : t("creating")}
                    </>
                  ) : (
                    t("nextStep")
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setStep("basic")}
                  disabled={uploadVideoMut.isPending}
                >
                  {t("prevStep")}
                </Button>
                <Button onClick={handlePublish} disabled={!videoUrl || uploadVideoMut.isPending}>
                  {t("publish")}
                </Button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
