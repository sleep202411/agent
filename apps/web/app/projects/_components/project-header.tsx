"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconChevronRight,
  IconCredits,
  IconCrown,
  IconRefresh,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { ProjectTabs, type ProjectTab } from "./project-tabs";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { IntegralRecord } from "@/src/types/workspace";
import { ProjectMessagesPopover } from "@/app/projects/_components/project-messages-popover";
import { ProjectTeamDialog } from "@/app/projects/_components/project-team-dialog";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import { StudioUserMenu } from "@/app/projects/_components/studio-user-menu";
import { CreditsRechargeDialog } from "@/components/payment/credits-recharge-dialog";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { setActiveTab, selectCurrentInstance } from "@/src/store/slices/projectSlice";
import {
  setCredits,
  setIntegralRecords,
  setCreditsLoading,
  setIntegralRecordsLoading,
} from "@/src/store/slices/userSlice";

interface ProjectHeaderProps {
  projectName: string;
  isLoading?: boolean;
}

export function ProjectHeader({ projectName, isLoading }: ProjectHeaderProps) {
  const t = useTranslations("project");
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();
  const project = useAppSelector((s) => selectCurrentInstance(s).detail);
  const worldDetail = useAppSelector((s) => selectCurrentInstance(s).worldDetail);
  const episodes = useAppSelector((s) => selectCurrentInstance(s).episodes);
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
            href="/art-studio/projects"
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
                href={`/projects/${project.id}/produce`}
                className="bg-gradient-to-r from-fuchsia-500 to-purple-500 text-white hover:from-fuchsia-400 hover:to-purple-400"
              >
                <IconSparkles className="size-3.5" />
                一键成片
              </Link>
            </Button>
          ) : null}

          {/* Credits + Upgrade as one segmented pill. Both halves
              share the chip's neutral background so it reads as one
              control; the upgrade half just borrows a soft primary
              tint + primary text so it's discoverable without
              shouting. Avoids the previous two-tone (transparent vs
              full purple gradient) clash. */}
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
                data-tour-step="upgrade"
                onClick={() => setUpgradeOpen(true)}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10"
              >
                <IconCrown className="size-3.5" />
                {tc("upgrade")}
              </button>
            </div>

            {creditsOpen ? (
              <div className="absolute right-0 top-12 z-50 w-96 rounded-2xl border border-border bg-popover p-3 shadow-2xl">
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
                      return (
                        <div
                          key={`${record.id ?? "record"}-${index}`}
                          className="rounded-xl border border-border px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm">{t(typeKey)}</span>
                            <span className="text-sm font-semibold">
                              {Number(record.integralChange ?? 0)}
                            </span>
                          </div>
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
                  {t("rechargeCredits")}
                </Button>
              </div>
            ) : null}
          </div>

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
