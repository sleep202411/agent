"use client";
import Link from "next/link";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { isValidLocale, defaultLocale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/types";

/** Review the immutable submitted version, not today's editable template. */
export function TaskDeliverySummary({ task }: { task: CrewTaskDTO }) {
  const t = useTranslations("crewTaskDeliveryLayout");
  const locale = useLocale();
  const submission = task.submissions.reduce<CrewTaskDTO["submissions"][number] | undefined>(
    (latest, item) => (!latest || item.versionNumber > latest.versionNumber ? item : latest),
    undefined
  );
  if (!submission) return null;
  const delivery = submission.professionalDelivery;
  function assetLink(id: string) {
    const asset = submission!.assets.find((item) => item.id === id);
    return asset ? (
      <Link
        key={id}
        className="block break-words text-sm underline underline-offset-4"
        href={localizePath(
          `/crews/${encodeURIComponent(task.crewId)}/workspace?tab=assets&asset=${encodeURIComponent(id)}`,
          isValidLocale(locale) ? locale : defaultLocale
        )}
      >
        {asset.name}
      </Link>
    ) : (
      <span key={id} className="text-xs text-muted-foreground">
        {t("unavailableFile")}
      </span>
    );
  }
  return (
    <section aria-label={t("latest")} className="mb-6 space-y-4 border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("latest")}</h3>
        <span className="text-xs text-muted-foreground">
          {t("version", { version: submission.versionNumber })}
        </span>
      </div>
      {delivery ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {delivery.definition.fields.map((field) => {
            const value = delivery.answers[field.key];
            return (
              <div
                key={field.key}
                className={`rounded-lg bg-white/[0.035] p-4 ${field.type === "text" ? "sm:col-span-2" : ""}`}
              >
                <h4 className="mb-2 text-xs font-semibold">{field.label}</h4>
                {field.type === "text" ? (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {typeof value === "string" && value.trim() ? value : "—"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {Array.isArray(value) && value.length ? value.map(assetLink) : "—"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {submission.assets.length ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold">{t("files")}</h4>
          {submission.assets.map((asset) => assetLink(asset.id))}
        </div>
      ) : null}
      {submission.note ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold">{t("notes")}</h4>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {submission.note}
          </p>
        </div>
      ) : null}
      {submission.reviewNote ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold">{t("reviewNotes")}</h4>
          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {submission.reviewNote}
          </p>
        </div>
      ) : null}
    </section>
  );
}
