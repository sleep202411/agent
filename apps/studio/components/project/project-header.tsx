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
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ProjectTabs, type ProjectTab } from "./project-tabs";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { IntegralRecord } from "@/src/types/workspace";
import { ProjectMessagesPopover } from "@/components/project/project-messages-popover";
import { ProjectTeamDialog } from "@/components/project/project-team-dialog";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import { UserMenu } from "@/components/layout/user-menu";
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
  const locale = useLocale();
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
            href={`/${locale}/projects`}
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
          <Button
            data-tour-step="upgrade"
            size="sm"
            className="bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400"
            onClick={() => setUpgradeOpen(true)}
          >
            <IconCrown className="size-3.5" />
            {tc("upgrade")}
          </Button>

          <div className="relative">
            <button
              type="button"
              data-tour-step="credits"
              onClick={() => setCreditsOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-muted/20"
            >
              <IconCredits className="size-4 text-primary" />
              <span>{tc("credits")}</span>
              <span className="font-semibold">{isCreditsLoading ? "..." : displayCredits}</span>
            </button>

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
                    {integralRecords.map((record, index) => (
                      <div
                        key={`${record.id ?? "record"}-${index}`}
                        className="rounded-xl border border-border px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm">
                            {String(record.recordType ?? t("creditsChange"))}
                          </span>
                          <span className="text-sm font-semibold">
                            {Number(record.integralChange ?? 0)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {String(record.createTime ?? "")}
                        </div>
                      </div>
                    ))}
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

          <Button variant="outline" color="muted" size="sm" onClick={() => setTeamOpen(true)}>
            <IconUsers className="size-3.5" />
            {tc("team")}
          </Button>

          <ProjectMessagesPopover
            unreadCount={unreadCount}
            onUnreadCountChange={refreshUnreadCount}
          />

          <UserMenu
            credits={displayCredits}
            onUpgrade={() => setUpgradeOpen(true)}
            onRecharge={() => setRechargeOpen(true)}
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
