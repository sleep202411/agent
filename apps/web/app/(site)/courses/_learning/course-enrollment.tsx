"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";
import { learningApi } from "./api";

export function CourseEnrollment({ courseId }: { courseId: string }) {
  const { user } = useCurrentUser();
  return <EnrollmentForm key={`${user?.id ?? "guest"}:${courseId}`} courseId={courseId} />;
}

function EnrollmentForm({ courseId }: { courseId: string }) {
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
  const query = useQuery({
    queryKey: ["academy-learning", user?.id, courseId],
    enabled: !!user,
    queryFn: ({ signal }) => learningApi.course(courseId, signal),
    refetchInterval: 15000,
    retry: false,
  });
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
  if (!user || (query.isSuccess && !offer && !row)) return null;
  return (
    <section
      className="mt-5 space-y-3 rounded-xl bg-white/[0.035] p-4 text-sm"
      aria-label={t("learning")}
    >
      <Link className="underline" href={`/${locale}/academy/teaching`}>
        {t("teacherWorkspace")}
      </Link>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : query.error ? (
        <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
      ) : row ? (
        <>
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
      ) : offer?.enabled ? (
        <>
          <p>{t("price", { amount: offer.priceCredits })}</p>
          <Button disabled={busy} onClick={() => void perform(false)}>
            {t(busy ? "working" : "enroll")}
          </Button>
        </>
      ) : (
        <p>{t("unavailable")}</p>
      )}
    </section>
  );
}
