"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { IconCheck, IconClockHour4, IconPaperclip, IconRefresh } from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { isValidLocale, defaultLocale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { learningApi, type Enrollment, type Offering } from "./api";

export type CourseLearningState = {
  offering: Offering | null;
  enrollment: Enrollment | null;
  instructor?: boolean;
};

export function isParticipatingInstructor(
  state: CourseLearningState | undefined,
  userId?: string | number | null,
  instructors?: Array<{ userId: string | number }> | null
) {
  if (state?.instructor) return true;
  if (userId == null) return false;
  const id = String(userId);
  return Boolean(instructors?.some((item) => String(item.userId) === id));
}

/** True when the learner must enroll before watching / homework. */
export function courseRequiresEnrollment(
  state: CourseLearningState | undefined,
  extras?: {
    userId?: string | number | null;
    instructors?: Array<{ userId: string | number }> | null;
  }
) {
  if (isParticipatingInstructor(state, extras?.userId, extras?.instructors)) return false;
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
          <Link href={localizePath("/login", isValidLocale(locale) ? locale : defaultLocale)}>
            {t("signIn")}
          </Link>
        </Button>
      </section>
    );
  }

  if (mode === "gate" && query.isSuccess && (query.data.instructor || (!offer?.enabled && !row))) {
    return null;
  }
  if (mode === "homework" && query.isSuccess && !row) return null;

  if (mode === "homework") {
    return (
      <section className="mt-4 border-t border-[#1d1d29] pt-4" aria-label={t("learning")}>
        {query.isPending ? (
          <p className="text-[13px] text-[#aeb6c8]" role="status">
            {t("loading")}
          </p>
        ) : query.error ? (
          <div role="alert" className="space-y-2 text-[13px] text-[#ff8a8a]">
            <p>{query.error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : row ? (
          <HomeworkPanel
            row={row}
            busy={busy}
            error={error}
            description={description}
            files={files}
            setDescription={setDescription}
            setFiles={setFiles}
            onSubmit={() => void perform(true)}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl bg-white/[0.035] p-6 text-sm"
      aria-label={t("learning")}
    >
      <h2 className="text-base font-semibold">{t("enrollToWatch")}</h2>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
      ) : offer?.enabled && !row ? (
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
      )}
    </section>
  );
}

function HomeworkPanel({
  row,
  busy,
  error,
  description,
  files,
  setDescription,
  setFiles,
  onSubmit,
}: {
  row: Enrollment;
  busy: boolean;
  error: string;
  description: string;
  files: File[];
  setDescription: (value: string) => void;
  setFiles: (files: File[]) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("academyLearning");
  const canSubmit = row.status === "enrolled" || row.status === "revision";
  return (
    <div className="space-y-3 text-[13px]">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-white">{t("homeworkSection")}</h2>
        <HomeworkStatus status={row.status} />
      </header>

      {row.status === "enrolled" ? (
        <p className="text-[12px] leading-5 text-[#8b93a7]">{t("submitHint")}</p>
      ) : null}
      {row.status === "submitted" ? (
        <p className="text-[12px] leading-5 text-[#8b93a7]">{t("awaitingReviewHint")}</p>
      ) : null}
      {row.status === "revision" ? (
        <p className="text-[12px] leading-5 text-[#c4a36a]">{t("revisionHint")}</p>
      ) : null}

      {row.score != null || row.feedback ? (
        <div className="space-y-2 rounded-lg bg-[#111119] px-3 py-2.5">
          {row.score != null ? (
            <div>
              <p className="text-[11px] text-[#6f7585]">{t("yourScore")}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                {row.score}
                <span className="text-[13px] font-medium text-[#6f7585]">/100</span>
              </p>
            </div>
          ) : null}
          {row.feedback ? (
            <div>
              <p className="text-[11px] text-[#6f7585]">{t("teacherFeedback")}</p>
              <p className="mt-1 whitespace-pre-wrap leading-5 text-[#d5dbe8]">{row.feedback}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {row.status === "approved" ? (
        <p
          className={
            row.badgeIssuedAt
              ? "inline-flex items-center gap-1.5 text-[12px] text-[#7dcea0]"
              : "inline-flex items-center gap-1.5 text-[12px] text-[#8b93a7]"
          }
        >
          {row.badgeIssuedAt ? (
            <IconCheck className="size-3.5" />
          ) : (
            <IconClockHour4 className="size-3.5" />
          )}
          {t(row.badgeIssuedAt ? "badgeIssued" : "badgePending")}
        </p>
      ) : null}

      {row.description && !canSubmit ? (
        <p className="whitespace-pre-wrap leading-5 text-[#aeb6c8]">{row.description}</p>
      ) : null}

      {error ? (
        <p className="text-[12px] text-[#ff8a8a]" role="alert">
          {error}
        </p>
      ) : null}

      {canSubmit ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-[#8b93a7]">{t("description")}</span>
            <textarea
              required
              maxLength={10000}
              value={description}
              disabled={busy}
              placeholder={t("descriptionPlaceholder")}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 rounded-lg border border-[#2a2a39] bg-[#111119] px-3 py-2.5 text-[13px] leading-5 text-white outline-none placeholder:text-[#5c6374] focus:border-[#6f222d]"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[11px] font-medium text-[#8b93a7]">{t("attachments")}</span>
            <span className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#2a2a39] bg-[#111119] px-3 py-2.5 text-[#aeb6c8] hover:border-[#3a3a4d]">
              <IconPaperclip className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {files.length ? t("filesSelected", { count: files.length }) : t("chooseFiles")}
              </span>
              <input
                type="file"
                required
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                disabled={busy}
                aria-label={t("attachments")}
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                className="sr-only"
              />
            </span>
            {files.length ? (
              <ul className="space-y-1 text-[12px] text-[#8b93a7]">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`} className="truncate">
                    {file.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
          <Button
            type="submit"
            disabled={busy || files.length === 0 || files.length > 10}
            className="h-9 w-full bg-[#f0444c] text-white hover:bg-[#e52227]"
          >
            {busy ? <IconRefresh className="size-3.5 animate-spin" /> : null}
            {t(busy ? "working" : "submit")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function HomeworkStatus({ status }: { status: Enrollment["status"] }) {
  const t = useTranslations("academyLearning");
  const label = status === "enrolled" ? t("notSubmitted") : t(status);
  const tone =
    status === "approved"
      ? "bg-[#12301f] text-[#7dcea0]"
      : status === "submitted"
        ? "bg-[#1a2438] text-[#8eb4e8]"
        : status === "revision"
          ? "bg-[#2d2413] text-[#e0b56a]"
          : "bg-[#1c1c27] text-[#aeb6c8]";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
  );
}
