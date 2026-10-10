"use client";
import { useTranslations } from "@/src/i18n/i18n";
import { computeRequestsPageSchema } from "@/app/(site)/crews/_hooks/compute-requests-data";

// Sum the complete usage aggregate, never the paginated request list. Preserve
// unknown values while an older server is rolling out the aggregate field.
export function taskRequestedPoints(data: unknown): {
  isOwner: boolean;
  byTask: Map<string, string | null>;
} | null {
  const parsed = computeRequestsPageSchema.safeParse(data);
  if (!parsed.success || !parsed.data.taskUsage) return null;
  const byTask = new Map<string, string | null>();
  for (const row of parsed.data.taskUsage) {
    if (row.requestedPoints == null || byTask.get(row.taskId) === null) {
      byTask.set(row.taskId, null);
    } else {
      byTask.set(
        row.taskId,
        (BigInt(byTask.get(row.taskId) ?? "0") + BigInt(row.requestedPoints)).toString()
      );
    }
  }
  return { isOwner: parsed.data.isOwner, byTask };
}

export function TaskCardPoints({
  requested,
  estimated,
  isOwner,
}: {
  requested: string | null;
  estimated: number | null | undefined;
  isOwner: boolean;
}) {
  const t = useTranslations("crewTaskProject.workbench");
  const amount = (value: string | null) =>
    value == null ? "—" : BigInt(value).toLocaleString("en-US");
  return (
    <dl className="relative z-10 my-1 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 border-y border-white/5 py-1 text-[11px] text-muted-foreground">
      <dt title={t("requestedPointsHelp")}>
        {t(isOwner ? "requestedPoints" : "myRequestedPoints")}
      </dt>
      <dd
        className="font-bold text-foreground"
        title={requested === null ? t("pointsUnavailable") : undefined}
      >
        {amount(requested)}
      </dd>
      <dt title={t("estimatedPointsHelp")}>{t("estimatedPoints")}</dt>
      <dd title={t("estimatedPointsHelp")}>
        {amount(
          estimated == null || !Number.isSafeInteger(estimated) || estimated < 0
            ? null
            : String(estimated)
        )}
      </dd>
    </dl>
  );
}
