"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { learningApi, type Enrollment, type Offering } from "./api";

export type CourseLearningState = {
  offering: Offering | null;
  enrollment: Enrollment | null;
};

/** True when the learner must enroll before watching / homework. */
export function courseRequiresEnrollment(state: CourseLearningState | undefined) {
  return Boolean(state?.offering?.enabled && !state.enrollment);
}

export function useCourseLearning(courseId: string) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["academy-learning", user?.id, courseId],
    enabled: !!user,
    queryFn: ({ signal }) => learningApi.course(courseId, signal),
    refetchInterval: 15000,
    retry: false,
  });
}

/** Outside the lesson: price + enroll only. */
export function CourseEnrollGate({ courseId }: { courseId: string }) {
  const { user } = useCurrentUser();
  return (
    <EnrollActions
      key={`${user?.id ?? "guest"}:${courseId}:gate`}
      courseId={courseId}
      mode="gate"
    />
  );
}

/** Inside the lesson after enrollment: status + homework. */
export function CourseHomeworkPanel({ courseId }: { courseId: string }) {
  const { user } = useCurrentUser();
  return (
    <EnrollActions
      key={`${user?.id ?? "guest"}:${courseId}:homework`}
      courseId={courseId}
      mode="homework"
    />
  );
}

/** @deprecated Prefer CourseEnrollGate / CourseHomeworkPanel. */
export function CourseEnrollment({ courseId }: { courseId: string }) {
  return <CourseHomeworkPanel courseId={courseId} />;
}

function EnrollActions({ courseId, mode }: { courseId: string; mode: "gate" | "homework" }) {
  const { user } = useCurrentUser();
  const t = useTranslations("academyLearning");
  const locale = useLocale();
  const client = useQueryClient();
  const lock = useRef(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const query = useCourseLearning(courseId);
  const row = query.data?.enrollment;
  const offer = query.data?.offering;

  async function perform(submit: boolean) {
    if (lock.current || !user) return;
    lock.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      if (submit && row) {
        const assetIds = [];
        for (const file of files) {
          controller.signal.throwIfAborted();
          const asset = await uploadFileViaSignedUrl(file, {
            signal: controller.signal,
            kind: file.type.startsWith("image/")
              ? "agent_attachment_image"
              : "agent_attachment_document",
          });
          assetIds.push(asset.mediaAssetId);
        }
        controller.signal.throwIfAborted();
        await learningApi.submit(
          row.id,
          { expectedVersion: row.version, description, assetIds },
          controller.signal
        );
        setFiles([]);
        setDescription("");
      } else if (offer) await learningApi.enroll(courseId, offer.version, controller.signal);
      controller.signal.throwIfAborted();
      await client.invalidateQueries({ queryKey: ["academy-learning", user.id, courseId] });
      await client.invalidateQueries({ queryKey: ["wallet"] });
      if (!submit)
        await client.invalidateQueries({ queryKey: ["public-course-play", Number(courseId)] });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
      operation.current = null;
    }
  }

  if (!user) {
    if (mode !== "gate") return null;
    return (
      <section
        className="mx-auto flex max-w-md flex-col gap-3 rounded-xl bg-white/[0.035] p-6 text-sm"
        aria-label={t("learning")}
      >
        <p>{t("signInToEnroll")}</p>
        <Button asChild>
          <Link href={localizePath("/login", locale)}>{t("signIn")}</Link>
        </Button>
      </section>
    );
  }

  if (mode === "gate" && query.isSuccess && !offer?.enabled && !row) {
    return null;
  }
  if (mode === "homework" && query.isSuccess && !row) return null;

  return (
    <section
      className={
        mode === "gate"
          ? "mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl bg-white/[0.035] p-6 text-sm"
          : "mt-5 space-y-3 rounded-xl bg-white/[0.035] p-4 text-sm"
      }
      aria-label={t("learning")}
    >
      {mode === "gate" ? <h2 className="text-base font-semibold">{t("enrollToWatch")}</h2> : null}
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
      ) : mode === "gate" ? (
        offer?.enabled && !row ? (
          <>
            <p>{t("price", { amount: offer.priceCredits })}</p>
            <p className="text-[#aeb6c8]">{t("enrollGateHint")}</p>
            <Button disabled={busy} onClick={() => void perform(false)}>
              {t(busy ? "working" : "enroll")}
            </Button>
          </>
        ) : row ? (
          <p>{t("enrolledOpenCourse")}</p>
        ) : (
          <p>{t("unavailable")}</p>
        )
      ) : row ? (
        <>
          <h2 className="text-sm font-semibold">{t("homeworkSection")}</h2>
          <p>{t(row.status)}</p>
          {row.feedback && (
            <p className="whitespace-pre-wrap">
              {row.score}/100 · {row.feedback}
            </p>
          )}
          {row.status === "approved" && (
            <p>{t(row.badgeIssuedAt ? "badgeIssued" : "badgePending")}</p>
          )}
          {["enrolled", "revision"].includes(row.status) && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(true);
              }}
            >
              <label className="grid gap-2">
                {t("description")}
                <textarea
                  required
                  maxLength={10000}
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-24 rounded-lg border border-white/15 bg-transparent p-3"
                />
              </label>
              <label className="grid gap-2">
                {t("attachments")}
                <input
                  type="file"
                  required
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={busy}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              <Button type="submit" disabled={busy || files.length === 0 || files.length > 10}>
                {t(busy ? "working" : "submit")}
              </Button>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}
