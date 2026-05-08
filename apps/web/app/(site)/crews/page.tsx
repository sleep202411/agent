"use client";

/**
 * Crew listing — preserves the platform's hero (CTA + stats) and overlays
 * the legacy fizzdragon-web filtering / pagination contract on a compact
 * 4-up poster grid. Data layer in `_hooks/use-projects.ts`.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { IconMovie, IconPlus, IconUsers } from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PLATFORM_STATS, useCrewLanding } from "@/app/(site)/crews/_hooks/use-crew";
import {
  useProjectRoles,
  useProjectsByJob,
  type ProjectListItem,
  type ProjectRole,
} from "@/app/(site)/crews/_hooks/use-projects";
import { CreateCrewDialog } from "@/app/(site)/crews/_components/create-crew-dialog";

const ALL_ROLE_ID = -1;

export default function CrewsPage() {
  const tCrew = useTranslations("crew");
  const t = useTranslations("crew.list");
  const locale = useLocale() as Locale;

  const [activeRoleId, setActiveRoleId] = useState<number>(ALL_ROLE_ID);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: roles = [] } = useProjectRoles();
  const roleById = useMemo(() => {
    const map = new Map<number, ProjectRole>();
    for (const r of roles) map.set(r.id, r);
    return map;
  }, [roles]);

  const filterRoleId = activeRoleId === ALL_ROLE_ID ? undefined : activeRoleId;
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useProjectsByJob(filterRoleId);
  const items = useMemo(() => (data?.pages ?? []).flatMap((p) => p.items), [data]);

  const { data: landing } = useCrewLanding();

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=2400&q=80"
          alt=""
          aria-hidden
          className="absolute inset-0 size-full object-cover object-[80%_center] opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/30" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 50%, hsl(210 100% 56% / 0.12) 0%, transparent 55%), radial-gradient(circle at 85% 20%, hsl(0 78% 52% / 0.1) 0%, transparent 50%)",
          }}
        />
        <div className="relative mx-auto max-w-[1800px] px-6 pb-12 pt-14">
          <div className="mb-3 flex items-center gap-2">
            <IconMovie className="size-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              {tCrew("plaza")}
            </span>
          </div>
          <div className="max-w-2xl">
            <h1 className="mb-3 text-3xl font-black leading-tight text-foreground md:text-4xl">
              {tCrew("heroTitle1")}
              <br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                {tCrew("heroTitle2")}
              </span>
            </h1>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              {tCrew("heroDesc")}
            </p>
            <div className="mb-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {(landing?.stats ?? PLATFORM_STATS).map((s) => (
                <span key={s.labelKey}>
                  <strong className="text-foreground">{s.value}</strong> {tCrew(s.labelKey)}
                </span>
              ))}
            </div>
            {/* Hero CTA temporarily hidden 2026-05-08 ahead of a
                deployment cut — backend hasn't shipped the full crew
                CRUD yet (update / delete / "my crews" list), so the
                creation entry is being held back to avoid users making
                crews they can't manage. Re-enable by un-commenting the
                Button below; the dialog itself stays mounted and
                wired so re-enabling is a one-line change. */}
            {/* <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <IconPlus className="size-4" />
              {tCrew("createStudio")}
            </Button> */}
          </div>
        </div>
      </div>

      <CreateCrewDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* ── Browse ──────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-6 pb-24 pt-8">
        {/* Role pills */}
        {roles.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <RolePill
              label={t("filterAll")}
              active={activeRoleId === ALL_ROLE_ID}
              onClick={() => setActiveRoleId(ALL_ROLE_ID)}
            />
            {roles.map((role) => (
              <RolePill
                key={role.id}
                label={role.name}
                active={activeRoleId === role.id}
                onClick={() =>
                  // Click an already-active pill clears it (legacy parity).
                  setActiveRoleId((prev) => (prev === role.id ? ALL_ROLE_ID : role.id))
                }
              />
            ))}
          </div>
        )}

        {/* Project grid */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {isLoading ? (
            <CardSkeleton count={10} />
          ) : items.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
              {t("noData")}
            </div>
          ) : (
            items.map((p) => (
              <ProjectCard
                key={p.project.id}
                item={p}
                roleById={roleById}
                fallbackOwner={t("notAvailable")}
                openRolesLabel={tCrew("openPositions")}
                locale={locale}
              />
            ))
          )}
        </div>

        {/* Load more */}
        {items.length > 0 && (
          <div className="mt-10 flex justify-center">
            <button
              type="button"
              disabled={!hasNextPage || isFetchingNextPage}
              onClick={() => fetchNextPage()}
              className={cn(
                "inline-flex h-11 items-center rounded-xl border border-border px-6 text-sm font-semibold transition-colors",
                hasNextPage && !isFetchingNextPage
                  ? "bg-secondary text-foreground hover:bg-secondary/80"
                  : "cursor-not-allowed text-muted-foreground"
              )}
            >
              {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RolePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors",
        active
          ? "border border-primary/40 bg-primary/10 text-primary"
          : "bg-white/5 text-muted-foreground hover:bg-white/10"
      )}
    >
      {label}
    </button>
  );
}

function ProjectCard({
  item,
  roleById,
  fallbackOwner,
  openRolesLabel,
  locale,
}: {
  item: ProjectListItem;
  roleById: Map<number, ProjectRole>;
  fallbackOwner: string;
  openRolesLabel: string;
  locale: Locale;
}) {
  const router = useRouter();
  const banner = item.project.bannerLink
    ? `${env.BANNER_BASE_URL}/${item.project.bannerLink}`
    : env.DEFAULT_COVER_URL;
  // Backend can return `owner: null` for crews whose owner row was
  // soft-deleted or never linked. Guard both reads so the card still
  // renders with the fallback nickname instead of crashing the list.
  const avatar = item.owner?.avatar ? `${env.USER_BASE_URL}/${item.owner.avatar}` : "";
  const detailHref = localizePath(`/crews/${item.project.id}`, locale);

  const jobCount = (item.jobs ?? []).filter((j) => roleById.has(j.roleId)).length;
  const tags = (item.tags ?? []).slice(0, 2);

  return (
    <article
      onClick={() => router.push(detailHref)}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card/40 transition-colors hover:border-border/80 hover:bg-card/60"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        <img
          src={banner}
          alt={item.project.name}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />
        {jobCount > 0 && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
            <IconUsers className="size-3" />
            {jobCount} {openRolesLabel}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-foreground">{item.project.name}</h3>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {avatar ? (
            <img src={avatar} alt="" className="size-4 rounded-full object-cover" />
          ) : (
            <div className="size-4 rounded-full bg-muted" />
          )}
          <span className="truncate">{item.owner?.nickName || fallbackOwner}</span>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function CardSkeleton({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card/40">
          <div className="aspect-[4/3] w-full animate-pulse bg-muted" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </>
  );
}
