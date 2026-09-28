"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchPlaySessionReport,
  type PlaySessionReport,
} from "@/src/lib/play-session-reporter.http";
import { useTranslations } from "@/src/i18n/i18n";
import {
  IconAlertTriangle,
  IconRefresh,
  IconClock,
  IconRoute,
  IconListCheck,
  IconUsers,
} from "@tabler/icons-react";

export function PlaySessionReportView({ sessionId }: { sessionId: string }) {
  const t = useTranslations("playSessionReport");
  const [report, setReport] = useState<PlaySessionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlaySessionReport(sessionId);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-xs text-white/50 backdrop-blur-md animate-pulse">
        {t("loading")}
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-xs text-white/70 backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-red-400">
          <IconAlertTriangle className="size-4" />
          <span>{error ?? t("error")}</span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20"
        >
          <IconRefresh className="size-3.5" />
          {t("retry")}
        </button>
      </div>
    );
  }

  const activePlayMsNum = Number(report.activePlayMs) || 0;
  const totalSeconds = Math.floor(activePlayMsNum / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const durationStr = t("duration", { minutes, seconds });

  const statusKey =
    report.status === "completed"
      ? "status_completed"
      : report.status === "abandoned"
        ? "status_abandoned"
        : "status_playing";
  const statusLabel = t(statusKey);

  const endingReachCountNum = Number(report.endingReachCount) || 0;
  const completedAtFormatted = report.completedAt
    ? new Date(report.completedAt).toLocaleString()
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/[0.06] p-4 text-xs text-white/80 shadow-2xl backdrop-blur-xl max-h-[45vh] overflow-y-auto">
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
        <span className="font-semibold text-white text-sm">{t("title")}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="flex items-center gap-1.5 text-white/70">
          <IconClock className="size-3.5 shrink-0 text-white/40" />
          <span>{durationStr}</span>
        </div>
        <div className="flex items-center gap-1.5 text-white/70">
          <IconRoute className="size-3.5 shrink-0 text-white/40" />
          <span>{t("pathCount", { count: report.path.length })}</span>
        </div>
        {endingReachCountNum > 0 ? (
          <div className="col-span-2 flex items-center gap-1.5 text-white/70">
            <IconUsers className="size-3.5 shrink-0 text-white/40" />
            <span>{t("endingReachCount", { count: endingReachCountNum })}</span>
          </div>
        ) : null}
      </div>

      {report.choices && report.choices.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5 font-medium text-white/90">
            <IconListCheck className="size-3.5 text-white/50" />
            <span>{t("choicesHeading")}</span>
          </div>
          <ul className="space-y-1 pl-4 list-disc text-white/70 text-[11px]">
            {report.choices.map((choice, i) => (
              <li key={i} className="wrap-anywhere">
                <span className="text-white/90">{choice.label}</span>
                <span className="text-white/40 text-[10px] ml-1.5">({choice.node})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {completedAtFormatted ? (
        <div className="border-t border-white/10 pt-2 text-[10px] text-white/40 text-right">
          {t("completedAt", { time: completedAtFormatted })}
        </div>
      ) : null}
    </div>
  );
}
