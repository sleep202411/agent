"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  IconUsers,
  IconPlayerPlay,
  IconCheck,
  IconPercentage,
  IconRefresh,
  IconAlertTriangle,
  IconLoader2,
} from "@tabler/icons-react";
import { api } from "@/lib/api";
import { StatCard } from "./stat-primitives";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export interface ProjectPlayStatsData {
  projectId: string;
  gameId?: string | null;
  contentVersion?: string | null;
  overview: {
    playerCount: string | number;
    startCount: string | number;
    completeCount: string | number;
    completeRate: number;
    replayRate: number;
  };
  chapters: Array<{ key: string; count: string | number; ratio: number }>;
  nodes: Array<{ key: string; count: string | number; ratio: number }>;
  choices: Array<{
    optionId: string;
    chapter: string;
    node: string;
    count: string | number;
    ratio: number;
  }>;
  endings: Array<{ key: string; count: string | number; ratio: number }>;
}

export function ProjectAnalyticsView({ projectId }: { projectId: string }) {
  const t = useTranslations("studioAnalytics");

  const query = useQuery({
    queryKey: ["story-project-play-stats", projectId],
    queryFn: () =>
      api.get<ProjectPlayStatsData>(
        `/api/user/project/play-stats?projectId=${encodeURIComponent(projectId)}&contentVersion=*`
      ),
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <IconLoader2 className="size-6 animate-spin text-white/40" />
        <span className="text-xs">{t("loading")}</span>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <FrostedPanel className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <IconAlertTriangle className="size-6 text-red-400" />
        <p className="text-sm text-red-300">{t("error")}</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-white/15"
        >
          <IconRefresh className="size-3.5" />
          {t("retry")}
        </button>
      </FrostedPanel>
    );
  }

  const { overview, endings = [], choices = [], nodes = [], chapters = [] } = query.data;

  // 1. Coerce longs to numbers
  const playerCount = Number(overview.playerCount) || 0;
  const startCount = Number(overview.startCount) || 0;
  const completeCount = Number(overview.completeCount) || 0;
  const completeRatePct = `${((overview.completeRate || 0) * 100).toFixed(1)}%`;
  const replayRatePct = `${((overview.replayRate || 0) * 100).toFixed(1)}%`;

  // 2. Cap nodes at top 20
  const topNodes = [...nodes]
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, 20);

  return (
    <div className="space-y-6">
      {/* 1. Overview Stat Cards */}
      <section>
        <h3 className="mb-3 text-sm font-semibold tracking-[-0.01em] text-white/90">
          {t("overview")}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={t("playerCount")} value={playerCount} hint={t("playerCountHint")} />
          <StatCard label={t("startCount")} value={startCount} />
          <StatCard label={t("completeCount")} value={completeCount} />
          <StatCard label={t("completeRate")} value={completeRatePct} />
          <StatCard label={t("replayRate")} value={replayRatePct} />
        </div>
      </section>

      {/* 2. Endings Table */}
      <section>
        <FrostedPanel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-white/90">{t("endingsHeading")}</h3>
          {endings.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnKey")}</TableHead>
                  <TableHead className="text-right">{t("columnCount")}</TableHead>
                  <TableHead className="text-right">{t("columnRatio")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endings.map((ending) => (
                  <TableRow key={ending.key}>
                    <TableCell className="font-medium text-white/80">{ending.key}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(ending.count) || 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {`${((ending.ratio || 0) * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FrostedPanel>
      </section>

      {/* 3. Choices Table */}
      <section>
        <FrostedPanel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-white/90">{t("choicesHeading")}</h3>
          {choices.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnOption")}</TableHead>
                  <TableHead>{t("columnChapter")}</TableHead>
                  <TableHead>{t("columnNode")}</TableHead>
                  <TableHead className="text-right">{t("columnCount")}</TableHead>
                  <TableHead className="text-right">{t("columnRatio")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {choices.map((choice, idx) => (
                  <TableRow key={`${choice.optionId}-${idx}`}>
                    <TableCell className="font-medium text-white/80">{choice.optionId}</TableCell>
                    <TableCell className="text-white/60">{choice.chapter}</TableCell>
                    <TableCell className="text-white/60">{choice.node}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(choice.count) || 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {`${((choice.ratio || 0) * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FrostedPanel>
      </section>

      {/* 4. Nodes Table (Top 20) */}
      <section>
        <FrostedPanel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-white/90">{t("nodesHeading")}</h3>
          {topNodes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnKey")}</TableHead>
                  <TableHead className="text-right">{t("columnCount")}</TableHead>
                  <TableHead className="text-right">{t("columnRatio")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topNodes.map((node) => (
                  <TableRow key={node.key}>
                    <TableCell className="font-medium text-white/80">{node.key}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(node.count) || 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {`${((node.ratio || 0) * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FrostedPanel>
      </section>

      {/* 5. Chapters Table */}
      <section>
        <FrostedPanel className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-white/90">{t("chaptersHeading")}</h3>
          {chapters.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnKey")}</TableHead>
                  <TableHead className="text-right">{t("columnCount")}</TableHead>
                  <TableHead className="text-right">{t("columnRatio")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chapters.map((ch) => (
                  <TableRow key={ch.key}>
                    <TableCell className="font-medium text-white/80">{ch.key}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(ch.count) || 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {`${((ch.ratio || 0) * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FrostedPanel>
      </section>
    </div>
  );
}
