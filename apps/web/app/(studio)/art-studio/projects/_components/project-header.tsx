"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconCredits,
  IconCrown,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProjectTabs, type ProjectTab } from "./project-tabs";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { IntegralRecord, WorkspacePanelKey } from "@/src/types/workspace";
import { ProjectMessagesPopover } from "@/app/(studio)/art-studio/projects/_components/project-messages-popover";
import { ProjectTeamDialog } from "@/app/(studio)/art-studio/projects/_components/project-team-dialog";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import { StudioUserMenu } from "@/app/(studio)/art-studio/projects/_components/studio-user-menu";
import { CreditsRechargeDialog } from "@/components/payment/credits-recharge-dialog";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { localizedProjectWorkspaceHref } from "@/src/lib/studio-routes";
import { setActiveTab, selectCurrentInstance, togglePanel } from "@/src/store/slices/projectSlice";
import {
  setCredits,
  setIntegralRecords,
  setCreditsLoading,
  setIntegralRecordsLoading,
} from "@/src/store/slices/userSlice";

// Numbered quick-access chips that nudge confused users toward the
// asset panels in the suggested setup order. Maps 1:1 onto the
// sidebar items so it's a duplicate surface, not a new feature —
// short-term workflow guidance until we can do something more
// principled. Each click dispatches togglePanel on the matching key.
//
// `assetField` points at the matching array on the project instance
// in Redux so the chip can show "done" once the user has at least
// one entry there.
const QUICK_PANELS: ReadonlyArray<{
  key: WorkspacePanelKey;
  labelKey: string;
  assetField: "episodes" | "characters" | "scenes" | "props";
}> = [
  { key: "episodes", labelKey: "episodes", assetField: "episodes" },
  { key: "characters", labelKey: "characters", assetField: "characters" },
  { key: "scenes", labelKey: "scenes", assetField: "scenes" },
  { key: "props", labelKey: "props", assetField: "props" },
];

interface ProjectHeaderProps {
  projectName: string;
  isLoading?: boolean;
}

export function ProjectHeader({ projectName, isLoading }: ProjectHeaderProps) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const tSidebar = useTranslations("sidebar");
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => selectCurrentInstance(s).detail);
  const worldDetail = useAppSelector((s) => selectCurrentInstance(s).worldDetail);
  const episodes = useAppSelector((s) => selectCurrentInstance(s).episodes);
  const characters = useAppSelector((s) => selectCurrentInstance(s).characters);
  const scenes = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const props = useAppSelector((s) => selectCurrentInstance(s).props);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const activeTab = useAppSelector((s) => selectCurrentInstance(s).activeTab);
  const credits = useAppSelector((s) => s.user.credits);
  const integralRecords = useAppSelector((s) => s.user.integralRecords);
  const isCreditsLoading = useAppSelector((s) => s.user.isCreditsLoading);
  const isIntegralRecordsLoading = useAppSelector((s) => s.user.isIntegralRecordsLoading);
  const creditsVersion = useAppSelector((s) => s.user.creditsVersion);

  const [creditsOpen, setCreditsOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const displayCredits = useMemo(() => {
    if (!credits) return 0;
    return Number.isFinite(credits) ? credits : 0;
  }, [credits]);

  const activeEpisodeTitle = useMemo(() => {
    const episode = episodes.find((item) => String(item.id) === String(activeEpisodeId));
    return String(episode?.title ?? episode?.name ?? "");
  }, [activeEpisodeId, episodes]);

  const worldName = useMemo(() => {
    return String(
      (worldDetail?.name as string | undefined) ??
        (worldDetail?.worldName as string | undefined) ??
        t("unnamedWorld")
    );
  }, [worldDetail]);

  useEffect(() => {
    dispatch(setCreditsLoading(true));
    backendApi
      .post<Record<string, unknown>>("/api/ai/record/myscore")
      .then((data) => {
        const value = Number(
          data.scoreBalance ?? data.score ?? data.credits ?? data.integral ?? data.value ?? 0
        );
        dispatch(setCredits(Number.isFinite(value) ? value : 0));
      })
      .catch((error) => {
        console.error("[ProjectHeader] 加载积分失败:", error);
        dispatch(setCreditsLoading(false));
      });
  }, [creditsVersion, dispatch]);

  const refreshUnreadCount = useCallback(() => {
    backendApi
      .post<number>("/api/user/message/unReadCount")
      .then((value) => setUnreadCount(Number(value ?? 0)))
      .catch((error) => console.error("[ProjectHeader] load unread count failed:", error));
  }, []);

  useEffect(() => {
    refreshUnreadCount();
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!creditsOpen) return;
    dispatch(setIntegralRecordsLoading(true));
    backendApi
      .post<Paginated<IntegralRecord>>("/api/ai/record/integralrecord/list", {
        data: { page: 1, pageSize: 20 },
      })
      .then((data) => dispatch(setIntegralRecords(data?.list ?? [])))
      .catch((error) => {
        console.error("[ProjectHeader] 加载积分记录失败:", error);
        dispatch(setIntegralRecordsLoading(false));
      });
  }, [creditsOpen, dispatch]);

  return (
    <>
      <header className="relative flex h-16 shrink-0 items-center gap-4 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            href="/art-studio"
            className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
          </Link>

          <div className="flex min-w-0 items-center gap-2 text-sm">
            {isLoading ? (
              <div className="h-4 w-52 animate-pulse rounded bg-muted" />
            ) : (
              <>
                <span className="max-w-36 truncate text-muted-foreground">{worldName}</span>
                <IconChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
                <span className="max-w-40 truncate font-semibold text-foreground">
                  {projectName || t("unnamedProject")}
                </span>
                <IconChevronRight className="size-4 shrink-0 text-muted-foreground/70" />
                <span className="max-w-32 truncate text-muted-foreground">
                  {activeEpisodeTitle || t("noEpisodeSelected")}
                </span>
              </>
            )}
          </div>

          {/* Numbered quick-panels — workflow nudge for first-time users.
           *  Hidden under xl since the centered ProjectTabs already
           *  reserves the middle of the bar; below xl we'd start
           *  fighting for horizontal space. Each chip shows the
           *  step number until the user adds at least one entry on
           *  that panel — then it flips to a green checkmark + count
           *  so a glance at the header tells them what's still empty. */}
          <div className="hidden items-center gap-1.5 xl:flex">
            {QUICK_PANELS.map((panel, idx) => {
              const count =
                panel.assetField === "episodes"
                  ? episodes.length
                  : panel.assetField === "characters"
                    ? characters.length
                    : panel.assetField === "scenes"
                      ? scenes.length
                      : props.length;
              const done = count > 0;
              return (
                <button
                  key={panel.key}
                  type="button"
                  onClick={() => dispatch(togglePanel(panel.key))}
                  title={tSidebar(panel.labelKey)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                    done
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                      : "border-border/60 bg-muted/60 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full text-[10px] font-semibold",
                      done ? "bg-emerald-500/25 text-emerald-300" : "bg-primary/15 text-primary"
                    )}
                  >
                    {done ? <IconCheck className="size-2.5" /> : idx + 1}
                  </span>
                  <span>{tSidebar(panel.labelKey)}</span>
                  {done ? <span className="text-[10px] opacity-80">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <ProjectTabs activeTab={activeTab} onTabChange={(tab) => dispatch(setActiveTab(tab))} />

        <div className="flex flex-1 items-center justify-end gap-2">
          {/* 一键开拍 — entry to the produce wizard. Distinct from the
              freeform Script/Storyboard/Timeline tabs in the centre:
              this is the guided pipeline (剧本 → 资产 → 视频) for
              users who'd rather follow rails than orchestrate the
              chat themselves. Sparkle + gradient ties it visually to
              the rest of the AI surfaces. Only shows when we know
              the project id, which we always do here once the
              header has hydrated. */}
          {project?.id ? (
            <Button asChild size="sm">
              <Link
                href={localizedProjectWorkspaceHref(project.id, {
                  suffix: "/produce",
                })}
                className="bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white hover:from-fuchsia-400 hover:to-purple-400"
              >
                <IconSparkles className="size-3.5" />
                {t("oneClickProduce")}
              </Link>
            </Button>
          ) : null}

          {/* Credits + Recharge + Upgrade as one 3-segment pill. The
              shared chip background reads as one control; each half
              uses hover tint to signal interactivity. Recharge sits
              between the read-only count and the loud upgrade CTA so
              the natural left-to-right reading is "you have N credits
              → top up → upgrade tier". */}
          <div className="relative hidden xl:block">
            <div className="flex items-center overflow-hidden rounded-xl border border-border bg-background/60">
              <button
                type="button"
                data-tour-step="credits"
                onClick={() => setCreditsOpen((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/30"
              >
                <IconCredits className="size-4 text-primary" />
                <span className="font-semibold">{isCreditsLoading ? "..." : displayCredits}</span>
              </button>
              <span className="h-5 w-px bg-border/70" aria-hidden />
              <button
                type="button"
                data-tour-step="recharge"
                onClick={() => setRechargeOpen(true)}
                className="flex items-center gap-1 bg-amber-500/[0.1] px-3 py-2 text-sm font-medium text-amber-500 transition-colors hover:bg-amber-500/20"
              >
                <IconPlus className="size-3.5" />
                {tc("rechargeCredits")}
              </button>
              <span className="h-5 w-px bg-border/70" aria-hidden />
              <button
                type="button"
                data-tour-step="upgrade"
                onClick={() => setUpgradeOpen(true)}
                className="flex items-center gap-1 bg-red-500/[0.1] px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/20"
              >
                <IconCrown className="size-3.5" />
                {tc("upgrade")}
              </button>
            </div>
          </div>

          {/* Credits-records popover. Lifted out of the `hidden xl:block`
              chip wrapper so it still renders on mobile/tablet, where the
              avatar dropdown's "Credit history" entry is the only opener.
              `fixed` positioning anchors to the viewport instead of the
              (now-hidden) chip. */}
          {creditsOpen ? (
            <div className="fixed right-4 top-16 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-3 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{t("creditsRecord")}</div>
                  <div className="text-xs text-muted-foreground">{t("creditsRecordDesc")}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    onClick={async () => {
                      dispatch(setCreditsLoading(true));
                      dispatch(setIntegralRecordsLoading(true));
                      try {
                        const [score, records] = await Promise.all([
                          backendApi.post<Record<string, unknown>>("/api/ai/record/myscore"),
                          backendApi.post<Paginated<IntegralRecord>>(
                            "/api/ai/record/integralrecord/list",
                            { data: { page: 1, pageSize: 20 } }
                          ),
                        ]);
                        const value = Number(
                          score.scoreBalance ??
                            score.score ??
                            score.credits ??
                            score.integral ??
                            score.value ??
                            0
                        );
                        dispatch(setCredits(Number.isFinite(value) ? value : 0));
                        dispatch(setIntegralRecords(records?.list ?? []));
                      } catch (error) {
                        console.error("[ProjectHeader] 刷新积分失败:", error);
                      } finally {
                        dispatch(setCreditsLoading(false));
                        dispatch(setIntegralRecordsLoading(false));
                      }
                    }}
                  >
                    <IconRefresh className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    onClick={() => setCreditsOpen(false)}
                  >
                    ×
                  </Button>
                </div>
              </div>

              {isIntegralRecordsLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <IconRefresh className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : integralRecords.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  {t("noCreditsRecord")}
                </div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-auto">
                  {integralRecords.map((record, index) => {
                    // Backend `recordType` enum: 1=recharge, 2=consume,
                    // 3=system gift. Anything outside the enum (or null)
                    // falls back to the generic "credits change" label.
                    const typeKey = (() => {
                      switch (String(record.recordType)) {
                        case "1":
                          return "recordTypeRecharge";
                        case "2":
                          return "recordTypeConsume";
                        case "3":
                          return "recordTypeSystemGift";
                        default:
                          return "creditsChange";
                      }
                    })();
                    // AI label fallback chain: aiName (friendly) →
                    // modelCode (raw id, e.g. STORY_OS / wan2.7-image-pro)
                    // → last segment of apiPath (e.g. "basic"). Skip
                    // entirely on recharge / system-gift rows where
                    // there's no AI provider to credit.
                    const aiLabel = (() => {
                      if (String(record.recordType) !== "2") return "";
                      if (record.aiName) return String(record.aiName);
                      if (record.modelCode) return String(record.modelCode);
                      if (record.apiPath) {
                        const tail = String(record.apiPath).split("/").filter(Boolean).pop();
                        return tail ?? "";
                      }
                      return "";
                    })();
                    const change = Number(record.integralChange ?? 0);
                    return (
                      <div
                        key={`${record.id ?? "record"}-${index}`}
                        className="rounded-xl border border-border px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm">{t(typeKey)}</span>
                          <span
                            className={cn(
                              "text-sm font-semibold tabular-nums",
                              change > 0
                                ? "text-green-500"
                                : change < 0
                                  ? "text-red-500"
                                  : "text-muted-foreground"
                            )}
                          >
                            {change > 0 ? `+${change}` : change}
                          </span>
                        </div>
                        {aiLabel ? (
                          <div className="mt-0.5 truncate text-xs text-foreground/70">
                            {aiLabel}
                          </div>
                        ) : null}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {String(record.createTime ?? "")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Button
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  setCreditsOpen(false);
                  setRechargeOpen(true);
                }}
              >
                <IconCredits className="size-3.5" />
                {tc("rechargeCredits")}
              </Button>
            </div>
          ) : null}

          <Button
            variant="outline"
            color="muted"
            size="sm"
            className="hidden xl:flex"
            onClick={() => setTeamOpen(true)}
          >
            <IconUsers className="size-3.5" />
            {tc("team")}
          </Button>

          <ProjectMessagesPopover
            unreadCount={unreadCount}
            onUnreadCountChange={refreshUnreadCount}
          />

          <StudioUserMenu
            credits={displayCredits}
            onUpgrade={() => setUpgradeOpen(true)}
            onRecharge={() => setRechargeOpen(true)}
            onTeam={() => setTeamOpen(true)}
            // Routes the dropdown entry into the same credits-records
            // popover the header's credits chip uses (line 255). One
            // panel, two ways in.
            onIntegralRecords={() => setCreditsOpen(true)}
          />
        </div>
      </header>

      <ProjectTeamDialog open={teamOpen} onOpenChange={setTeamOpen} project={project} />
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <CreditsRechargeDialog
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        onSuccess={() => dispatch(setCreditsLoading(true))}
      />
    </>
  );
}
