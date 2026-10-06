"use client";

/**
 * Crew Hall (`/crews`) — public landing for the crew module.
 *
 * Single feed from `GET /aurora/crews` with cursor-paginated infinite
 * scroll. Each card carries server-computed `memberCount` +
 * `openPositionCount` so render is one round-trip per page.
 *
 * Create flow: top-right CTA opens CreateCrewDialog, which on success
 * navigates to the new crew's workspace.
 */

import { isCrewCursorError } from "./_hooks/api";
import { CrewSectionNavigation } from "./_components/crew-section-navigation";
import { CrewWorkspace } from "./_components/crew-workspace";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  IconBriefcase,
  IconEye,
  IconLoader2,
  IconListCheck,
  IconUsersPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KycGateDialog } from "@/app/_components/kyc-gate-dialog";
import { useCrewList, useMyCrews, type CrewDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { CreateTaskEntryDialog } from "./_components/create-task-entry-dialog";
import { CreateCrewJobDialog } from "./_components/create-crew-job-dialog";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";
import { useTranslatePositionValue } from "@/app/(site)/crews/_hooks/use-position-label";
import { PositionsTab } from "@/app/(site)/crews/_components/positions-tab";
import { useKycAuthStatus } from "@/src/hooks/use-kyc";
import { useCurrentUser } from "@/src/hooks/use-user";

type ViewMode = "mine" | "crews" | "positions";

export default function CrewsPage() {
  const tCrew = useTranslations("crew");
  const t = useTranslations("crew.list");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const isCnRegion = env.SITE_REGION === "cn";
  const { user } = useCurrentUser();
  const myCrews = useMyCrews(Boolean(user));
  const myCrewItems = useMemo(() => {
    if (!user) return [];
    const memberships = [
      ...(myCrews.data?.community ?? []),
      ...(myCrews.data?.founded ?? []),
      ...(myCrews.data?.joined ?? []),
    ];
    return [...new Map(memberships.map((crew) => [crew.id, crew])).values()];
  }, [user, myCrews.data]);
  const requestedCrew = searchParams.get("crew");
  const selectedCrew = myCrewItems.find((crew) => crew.id === requestedCrew) ?? myCrewItems[0];
  const requestedView = searchParams.get("view");
  const view: ViewMode =
    requestedView === "positions" || requestedView === "crews" || requestedView === "mine"
      ? requestedView
      : user
        ? "mine"
        : "crews";
  const workspaceView = view === "positions" || (view === "mine" && !!selectedCrew);
  const setView = (next: ViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  // Persist the initially displayed crew so refreshes and shared URLs keep
  // the same selection, just like explicit switches in the crew rail.
  useEffect(() => {
    if (
      view !== "mine" ||
      !user ||
      !selectedCrew ||
      requestedCrew ||
      myCrews.isPending ||
      myCrews.isError
    )
      return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "mine");
    params.set("crew", selectedCrew.id);
    router.replace(localizePath(`/crews?${params.toString()}`, locale), { scroll: false });
  }, [
    view,
    user,
    selectedCrew,
    requestedCrew,
    myCrews.isPending,
    myCrews.isError,
    searchParams,
    router,
    locale,
  ]);

  const taskEntryT = useTranslations("taskEntry");
  const [taskEntryOpen, setTaskEntryOpen] = useState(false);
  const [entryMode, setEntryMode] = useState<"task" | "position">("task");
  const [positionCrew, setPositionCrew] = useState<string | null>(null);
  const [createForTask, setCreateForTask] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [kycGateOpen, setKycGateOpen] = useState(false);
  const [checkingKyc, setCheckingKyc] = useState(false);

  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    isFetchNextPageError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useCrewList(24);
  const cursorInvalid = isCrewCursorError(error, "CREW_CURSOR_INVALID");
  const { data: kycStatus, refetch: refetchKycStatus } = useKycAuthStatus({
    enabled: isCnRegion,
  });
  const items = useMemo<CrewDTO[]>(() => (data?.pages ?? []).flatMap((p) => p.items), [data]);

  const requestCreateCrew = async (forTask = false) => {
    setCreateForTask(forTask);
    if (!isCnRegion) {
      setCreateOpen(true);
      return;
    }

    setCheckingKyc(true);
    try {
      const status = kycStatus ?? (await refetchKycStatus()).data;
      if (status?.needAuth === true) {
        setKycGateOpen(true);
        return;
      }
      if (!status) {
        toast.error(tCrew("kycCheckFailed"));
        return;
      }
      setCreateOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCrew("kycCheckFailed"));
    } finally {
      setCheckingKyc(false);
    }
  };

  return (
    <div
      className={
        workspaceView
          ? "bg-background lg:h-[calc(100dvh-4rem)] lg:min-h-0"
          : "min-h-[calc(100dvh-8rem)] bg-background"
      }
    >
      <CreateTaskEntryDialog
        mode={entryMode}
        onSelectCrew={(crewId) => {
          setTaskEntryOpen(false);
          setPositionCrew(crewId);
        }}
        open={taskEntryOpen}
        onOpenChange={setTaskEntryOpen}
        onNewCrew={() => {
          setTaskEntryOpen(false);
          void requestCreateCrew(true);
        }}
      />
      {positionCrew && (
        <CreateCrewJobDialog
          key={`${user?.id}:${positionCrew}`}
          crewId={positionCrew}
          open
          onOpenChange={(open) => {
            if (!open) setPositionCrew(null);
          }}
        />
      )}
      <CreateCrewDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={
          createForTask
            ? (crew) =>
                entryMode === "position"
                  ? setPositionCrew(crew.id)
                  : router.push(
                      localizePath(
                        `/crews/${encodeURIComponent(crew.id)}/workspace?tab=tasks&createTask=1`,
                        locale
                      )
                    )
            : undefined
        }
      />
      <KycGateDialog
        open={kycGateOpen}
        onOpenChange={setKycGateOpen}
        description={tCrew("createKycRequiredDesc")}
      />

      <div
        className={`mx-auto max-w-[1800px] px-4 pt-4 sm:px-6 ${workspaceView ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col" : "pb-6"}`}
      >
        <div
          className={workspaceView ? "min-w-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : "min-w-0"}
        >
          <CrewSectionNavigation active={view} onViewChange={setView} sticky={!workspaceView}>
            <div className="ml-auto flex max-w-full min-w-0 flex-wrap gap-2 pb-2">
              {view === "positions" && (
                <Button
                  type="button"
                  size="lg"
                  className="h-11 gap-2 px-5 text-sm"
                  aria-describedby="production-action-help"
                  onClick={() => {
                    setEntryMode("position");
                    setTaskEntryOpen(true);
                  }}
                >
                  <IconBriefcase className="size-4 shrink-0" aria-hidden="true" />
                  {taskEntryT("positionTitle")}
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                className="h-11 gap-2 px-5 text-sm"
                aria-describedby={view === "positions" ? "production-action-help" : undefined}
                onClick={() => {
                  setEntryMode("task");
                  setTaskEntryOpen(true);
                }}
              >
                <IconListCheck className="size-4 shrink-0" aria-hidden="true" />
                {taskEntryT("title")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => void requestCreateCrew()}
                disabled={checkingKyc}
                className="h-11 gap-2 px-5 text-sm"
              >
                {checkingKyc ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconUsersPlus className="size-4 shrink-0" aria-hidden="true" />
                )}
                {tCrew("createStudio")}
              </Button>
            </div>
          </CrewSectionNavigation>
          {view === "positions" && (
            <p id="production-action-help" className="mb-4 text-sm text-muted-foreground">
              {taskEntryT("actionHelp")}
            </p>
          )}

          {view === "mine" ? (
            <section className="lg:min-h-0 lg:flex-1" aria-label={tCrew("myCrewsTitle")}>
              {!user ? (
                <p className="py-12 text-center text-muted-foreground">{tCrew("myCrewsSignIn")}</p>
              ) : (
                <>
                  {myCrews.isPending ? (
                    <CardSkeleton count={1} />
                  ) : selectedCrew ? (
                    <div className="h-[calc(100dvh-13rem)] min-h-[28rem] overflow-hidden lg:h-full lg:min-h-0">
                      <CrewWorkspace
                        key={`${user.id}:${selectedCrew.id}`}
                        id={selectedCrew.id}
                        embedded
                        communityOnly={
                          !!myCrews.data?.community?.some((crew) => crew.id === selectedCrew.id) &&
                          ![...(myCrews.data?.founded ?? []), ...(myCrews.data?.joined ?? [])].some(
                            (crew) => crew.id === selectedCrew.id
                          )
                        }
                      />
                    </div>
                  ) : null}
                  {!myCrews.isPending && !myCrews.isError && myCrewItems.length === 0 ? (
                    <p className="py-12 text-center text-muted-foreground">
                      {tCrew("myCrewsEmpty")}
                    </p>
                  ) : null}
                  {myCrews.isError ? (
                    <div
                      role="alert"
                      className="flex items-center justify-center gap-3 py-6 text-sm"
                    >
                      <span>
                        {myCrews.error instanceof Error ? myCrews.error.message : tc("loadFailed")}
                      </span>
                      <Button
                        variant="outline"
                        disabled={myCrews.isFetching}
                        onClick={() => void myCrews.refetch()}
                      >
                        {tc("retry")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : view === "crews" ? (
            <section className="pt-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {isLoading ? (
                  <CardSkeleton count={10} />
                ) : items.length === 0 && !isError ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
                    {t("noData")}
                  </div>
                ) : (
                  items.map((c) => <CrewCard key={c.id} item={c} locale={locale} />)
                )}
              </div>

              {isError && (
                <div
                  role="alert"
                  className="mt-6 flex items-center justify-center gap-3 text-sm text-muted-foreground"
                >
                  <span>
                    {error instanceof Error && error.message.trim()
                      ? error.message
                      : tc("loadFailed")}
                  </span>
                  <Button
                    variant="outline"
                    disabled={isFetching}
                    onClick={() =>
                      void (isFetchNextPageError && !cursorInvalid ? fetchNextPage() : refetch())
                    }
                  >
                    {tc("retry")}
                  </Button>
                </div>
              )}

              {items.length > 0 && hasNextPage && !isError && (
                <div className="mt-10 flex justify-center">
                  <button
                    type="button"
                    disabled={isFetching}
                    onClick={() => fetchNextPage()}
                    className={cn(
                      "inline-flex h-11 items-center rounded-xl border border-border px-6 text-sm font-semibold transition-colors",
                      isFetchingNextPage
                        ? "cursor-wait text-muted-foreground"
                        : "bg-secondary text-foreground hover:bg-secondary/80"
                    )}
                  >
                    {isFetchingNextPage ? t("loading") : t("loadMore")}
                  </button>
                </div>
              )}
            </section>
          ) : (
            <PositionsTab />
          )}
        </div>
      </div>
    </div>
  );
}

function CrewCard({
  item,
  locale,
  workspace = false,
}: {
  item: CrewDTO;
  locale: Locale;
  workspace?: boolean;
}) {
  const router = useRouter();
  const detailHref = localizePath(
    `/crews/${encodeURIComponent(item.id)}${workspace ? "/workspace" : ""}`,
    locale
  );
  return (
    <button
      type="button"
      onClick={() => router.push(detailHref)}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
    >
      <CrewCardInner item={item} />
    </button>
  );
}

/**
 * 新片场-style plaza card.
 *
 *   ┌──────────────────────────────┐
 *   │ ◯ Studio name [tier badge]    │  ← logo + name + open badge
 *   │   tagline · 5人 · 6mo · 北京    │  ← stats line
 *   │ Description...                │
 *   │ ─────────────────────────    │
 *   │ [thumb][title · 12.4w 看过]    │  ← featured work 1
 *   │ [thumb][title · 8.7k 看过]     │  ← featured work 2
 *   └──────────────────────────────┘
 *
 * Logo is the identity anchor (top-left). Showcase works render as
 * compact horizontal strips below — same affordance as 新片场 but
 * tuned for our 6-col density (1 work shown when card is narrow,
 * 2 when wider).
 */
function CrewCardInner({ item }: { item: CrewDTO }) {
  const tCrew = useTranslations("crew");
  const translatePosition = useTranslatePositionValue();
  const logoUrl = resolveAssetUrl(item.logo);
  const openCount = item.openPositionCount ?? 0;
  const memberCount = item.memberCount ?? 0;
  const tagLabels = [...(item.genres ?? []), ...(item.styles ?? [])].slice(0, 2);
  const isNew = daysSince(item.createdAt) <= 14;
  const works = (item.showcaseWorks ?? []).slice(0, 2);
  const positionPreview = (item.openPositionPreview ?? []).slice(0, 3);
  const positionOverflow = Math.max(0, openCount - positionPreview.length);

  return (
    <div className="flex flex-1 flex-col p-4">
      {/* ─── Header: logo + identity ─── */}
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={item.name}
          className="size-12 shrink-0 rounded-full object-cover"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-sm font-bold text-foreground">{item.name}</h3>
            {openCount > 0 ? (
              <span className="shrink-0 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                {openCount} {tCrew("hiringBadge")}
              </span>
            ) : null}
            {isNew && openCount === 0 ? (
              <span className="shrink-0 rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                {tCrew("newBadge")}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {memberCount} {tCrew("peopleShort")} ·{" "}
            {tCrew("foundedRelative", { time: foundedRelative(item.createdAt) })}
          </div>
        </div>
      </div>

      {/* Tagline / description */}
      {item.tagline ? (
        <p className="mt-2 line-clamp-1 text-xs text-primary/90">{item.tagline}</p>
      ) : item.description ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
      ) : null}

      {/* Taxonomy pills */}
      {tagLabels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {tagLabels.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tCrew(`taxonomy.${tag}` as Parameters<typeof tCrew>[0])}
            </span>
          ))}
        </div>
      ) : null}

      {/* Positions preview — "招募: 配音演员 · 音效师 +1". Empty
          when crew has no open positions (don't show "0 招募中"
          noise). */}
      {positionPreview.length > 0 ? (
        <div className="mt-2 flex items-center gap-1.5 text-[11px]">
          <IconBriefcase className="size-3 shrink-0 text-amber-400" />
          <span className="line-clamp-1 text-amber-400">
            {tCrew("hiringPreviewPrefix")}{" "}
            {positionPreview.map((p) => translatePosition(p)).join(" · ")}
            {positionOverflow > 0 ? (
              <span className="text-muted-foreground"> +{positionOverflow}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* ─── Featured works (compact strip — 新片场 style) ─── */}
      {works.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
          {works.map((w) => (
            <div key={w.thumbnailUrl} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={w.thumbnailUrl}
                alt={w.title}
                className="aspect-video h-10 shrink-0 rounded object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1 text-[11px] font-medium text-foreground">
                  {w.title}
                </div>
                {typeof w.viewCount === "number" ? (
                  <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <IconEye className="size-2.5" />
                    {formatCount(w.viewCount)}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────

/** Banner-OSS path → absolute URL helper. Crew logos are uploaded via
 *  `uploadBanner()` (POST /project/uploadBanner), which lands them in
 *  the dedicated banner bucket (`BANNER_BASE_URL`), NOT the primary
 *  `OSS_BASE_URL` bucket — using the wrong base returns 404 from OSS.
 *  `http(s)://...` passes through. Empty input returns "" — Crew.logo
 *  is NOT NULL at the schema level so this branch should never fire
 *  in practice. */
function resolveAssetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${env.BANNER_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function daysSince(iso: string): number {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return Infinity;
  return Math.floor((Date.now() - ts) / 86_400_000);
}

/** 12300 → "12.3k" / 1840000 → "184w" (中文万). */
function formatCount(n: number): string {
  if (n >= 10_000) {
    const w = n / 10_000;
    return `${w >= 10 ? w.toFixed(0) : w.toFixed(1)}w`;
  }
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Relative-time string for crew founding ("3 天前" / "Mar 2026"). */
function foundedRelative(iso: string): string {
  const d = daysSince(iso);
  if (!Number.isFinite(d)) return "";
  if (d < 1) return "today";
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card/40">
          <div className="aspect-video w-full animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </>
  );
}
