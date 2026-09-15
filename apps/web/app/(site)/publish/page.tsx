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

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import posthog from "posthog-js";
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
  const { user } = useCurrentUser();
  return <PublishWizard key={user?.id ?? "guest"} />;
}

function PublishWizard() {
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

  const active = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const preview = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const abandon = () => {
    active.current = false;
    operation.current?.abort();
    operation.current = null;
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = undefined;
  };
  useLayoutEffect(() => {
    active.current = true;
    return abandon;
  }, []);
  const begin = () => {
    if (!active.current || operation.current) return null;
    const request = new AbortController();
    operation.current = request;
    setBusy(true);
    return request;
  };
  const current = (request: AbortController) =>
    active.current && operation.current === request && !request.signal.aborted;
  const finish = (request: AbortController) => {
    if (!current(request)) return;
    operation.current = null;
    setBusy(false);
  };
  const goBackToProfile = () => {
    abandon();
    router.replace(localizePath("/profile", locale));
  };

  const handleNext = async () => {
    if (!isBasicValid) {
      toast.warning(t("pleaseCompleteInfo"));
      return;
    }
    const request = begin();
    if (!request) return;
    try {
      if (personalId == null) {
        const res = await createMut.mutateAsync({
          title: form.title.trim(),
          introduction: form.description.trim(),
          tags: form.tagIds,
          viewStatus: 1,
        });
        if (!current(request)) return;
        setPersonalId(res.id);
      } else {
        await updateMut.mutateAsync({
          id: personalId,
          title: form.title.trim(),
          introduction: form.description.trim(),
          viewStatus: 1,
        });
      }
      if (current(request)) setStep("upload");
    } catch {
      if (current(request)) toast.error(personalId == null ? t("createFailed") : t("updateFailed"));
    } finally {
      finish(request);
    }
  };

  const handleUploadVideo = async (file: File) => {
    if (personalId == null) return;
    const request = begin();
    if (!request) return;
    try {
      await uploadVideoMut.mutateAsync({ personalId, file, signal: request.signal });
      if (!current(request)) return;
      // For local preview, point at the picked File; backend playback
      // URL becomes available once the publish completes.
      const url = URL.createObjectURL(file);
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = url;
      setVideoUrl(url);
      toast.success(t("uploadSuccess"));
    } catch {
      if (current(request)) toast.error(t("uploadFailed"));
    } finally {
      finish(request);
    }
  };

  const handleUploadCover = async (file: File) => {
    if (personalId == null) return;
    const request = begin();
    if (!request) return;
    try {
      await uploadCoverMut.mutateAsync({ personalId, file, signal: request.signal });
      if (!current(request)) return;
      toast.success(t("uploadSuccess"));
    } catch {
      if (current(request)) toast.error(t("uploadFailed"));
    } finally {
      finish(request);
    }
  };

  const handlePublish = () => {
    if (!videoUrl) {
      toast.warning(t("pleaseUploadVideo"));
      return;
    }
    const request = begin();
    if (!request) return;
    posthog.capture("video_published", {
      personal_id: personalId,
      tag_count: form.tagIds.length,
    });
    toast.success(t("publishSuccess"));
    timer.current = setTimeout(() => {
      if (current(request)) goBackToProfile();
    }, 1200);
  };

  // Step config keeps the sidebar render simple.
  const steps: { key: Step; label: string }[] = [
    { key: "basic", label: t("stepBasic") },
    { key: "upload", label: t("stepUpload") },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  const submitting = busy || createMut.isPending || updateMut.isPending;

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
              uploading={busy}
              onPickVideo={handleUploadVideo}
              onPickCover={handleUploadCover}
              coverUploading={busy}
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
                <Button variant="outline" onClick={() => setStep("basic")} disabled={busy}>
                  {t("prevStep")}
                </Button>
                <Button onClick={handlePublish} disabled={!videoUrl || busy}>
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
