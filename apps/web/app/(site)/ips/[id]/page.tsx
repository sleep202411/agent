"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconBolt,
  IconChevronDown,
  IconCircleCheck,
  IconLoader2,
  IconMessageCircle,
  IconMovie,
  IconPlayerPlay,
  IconPlaylist,
  IconShoppingCart,
  IconStar,
  IconTrendingUp,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { env } from "@/src/env";
import {
  STAGE_CONFIG,
  EMPTY_IP_DETAIL,
  type IPDetail,
  type IPStage,
} from "@/app/(site)/ips/_data/ip";
import { mockIPDetailContent } from "@/app/(site)/ips/_data/ip-mock";
import {
  useProjectDetail,
  useProjectVideoLink,
  useProjectMembers,
  useProjectJobs,
  useProjectEpisodes,
  type Episode,
} from "@/app/(site)/ips/_hooks/use-ip";

const STAGE_ICON: Record<IPStage, typeof IconTrendingUp> = {
  investment: IconTrendingUp,
  presale: IconShoppingCart,
  producing: IconMovie,
  released: IconCircleCheck,
};

// Stage-specific primary CTA for the sticky action bar.
const STAGE_CTA_KEY: Record<IPStage, string> = {
  investment: "subscribeNow",
  presale: "preorderNow",
  producing: "notifyMe",
  released: "watchNow",
};

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function totalRuntime(eps: Episode[]): string {
  return formatDuration(eps.reduce((acc, e) => acc + (e.duration || 0), 0));
}

// ─── Page ────────────────────────────────────────────

export default function IPDetailPage({ id }: { id: string }) {
  const t = useTranslations("ip");

  const { data: project, isLoading } = useProjectDetail(id);
  const { data: videoLink } = useProjectVideoLink(id);
  const { data: members } = useProjectMembers(id);
  useProjectJobs(id); // prefetch — surface in updates / hiring later
  const { data: realEpisodes = [] } = useProjectEpisodes(id);

  // Fully populated mock content for fields the backend doesn't expose yet.
  // Each consumer below prefers real data and falls back to mock per-field
  // so backend fields can land incrementally without breaking the demo.
  const mock = mockIPDetailContent(id);
  const episodes: Episode[] =
    realEpisodes.length > 0
      ? realEpisodes
      : mock.episodes.map((e) => ({
          id: e.id,
          projectId: id,
          title: e.title,
          description: e.description,
          videoUrl: e.videoUrl,
          cover: e.cover,
          duration: e.duration,
          type: "linear",
          sort: e.sort,
        }));

  // Cinema hero pin: once the hero scrolls out of view, surface a compact
  // sticky action bar so the primary CTA is always reachable.
  const heroSentinelRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [trailerPlaying, setTrailerPlaying] = useState(false);
  const trailerVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = heroSentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Bridge real API → existing IPDetail shape; per-field fallback to mock.
  const realTags: string[] = (() => {
    try {
      const parsed = JSON.parse(project?.tag ?? "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  })();
  const realTeam = (Array.isArray(members) ? members : []).map((m) => ({
    name: m.nickName || m.userName || "Member",
    role: m.roleName || "Team",
    avatar: m.avatar ? `${env.USER_BASE_URL || env.OSS_BASE_URL}/${m.avatar}` : "",
    level: "",
    projects: 0,
    rating: 0,
  }));

  const ip: IPDetail = {
    ...EMPTY_IP_DETAIL,
    id,
    title: project?.name || mock.title,
    tagline: mock.tagline,
    desc: project?.description || mock.tagline,
    cover: project?.bannerLink
      ? project.bannerLink.startsWith("http")
        ? project.bannerLink
        : `${env.BANNER_BASE_URL}/${project.bannerLink}`
      : mock.cover,
    story: project?.story || project?.background || mock.story,
    whyThisIP: project?.whyThisIP || mock.whyThisIP,
    tags: realTags.length > 0 ? realTags : mock.tags,
    team:
      realTeam.length > 0
        ? realTeam
        : mock.team.map((m) => ({
            name: m.name,
            role: m.role,
            avatar: m.avatar,
            level: m.level,
            projects: 0,
            rating: 0,
          })),
    updates: mock.updates,
    faqs: mock.faqs,
  };

  const stage = STAGE_CONFIG[ip.stage];
  const StageIcon = STAGE_ICON[ip.stage];

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const aboutBody = [ip.story, ip.whyThisIP].filter(Boolean).join("\n\n");
  const epCount = episodes.length;
  const trailerSrc = videoLink || mock.trailerUrl;
  const hasTrailer = !!trailerSrc;
  const heroMedia = hasTrailer ? trailerSrc : ip.cover;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Cinema hero ─────────────────────────────────── */}
      <section className="relative">
        {/* Top toolbar overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
          <Link
            href="/ips"
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white/85 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
          >
            <IconArrowLeft className="size-3.5" />
            {t("detailBackToPlaza")}
          </Link>
          <Link
            href={`/ips/${id}/edit`}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-medium text-white/85 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
          >
            {t("detailManage")}
          </Link>
        </div>

        {/* Media */}
        <div className="relative aspect-[21/9] max-h-[480px] w-full overflow-hidden bg-black">
          {hasTrailer ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={trailerVideoRef}
              key={trailerSrc}
              src={trailerSrc}
              poster={ip.cover || undefined}
              playsInline
              controls={trailerPlaying}
              onEnded={() => setTrailerPlaying(false)}
              onPause={() => setTrailerPlaying(false)}
              onPlay={() => setTrailerPlaying(true)}
              className="size-full object-cover"
            />
          ) : heroMedia ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={heroMedia} alt={ip.title} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center bg-muted/30">
              <IconPlaylist className="size-12 text-muted-foreground/30" />
            </div>
          )}

          {/* Big centered play button — visible only when trailer is paused */}
          {hasTrailer && !trailerPlaying && (
            <button
              type="button"
              onClick={() => {
                const v = trailerVideoRef.current;
                if (!v) return;
                v.muted = false;
                void v.play();
              }}
              aria-label={t("detailWatchTrailer")}
              className="group absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/20 transition-colors hover:bg-black/30"
            >
              <span className="inline-flex size-16 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-2xl shadow-black/40 ring-4 ring-white/10 backdrop-blur-sm transition-transform group-hover:scale-110">
                <IconPlayerPlay className="ml-1 size-7 fill-current" />
              </span>
              <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
                {t("detailWatchTrailer")}
              </span>
            </button>
          )}

          {/* Bottom legibility gradient — only when not actively playing so it
              doesn't fight the native controls bar */}
          {!trailerPlaying && (
            <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-background via-background/60 to-transparent" />
          )}
        </div>

        {/* Hero info — bleeds up over the bottom of the media */}
        <div className="relative z-10 mx-auto -mt-24 max-w-screen-2xl px-6 sm:-mt-32">
          <div className="max-w-3xl">
            <span
              className={cn(
                "mb-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                stage.badge
              )}
            >
              <StageIcon className="size-3.5" />
              {t(stage.labelKey)}
            </span>
            <h1 className="font-heading text-3xl font-bold text-foreground drop-shadow-md sm:text-4xl">
              {ip.title || t("detailUntitled")}
            </h1>
            {ip.desc && (
              <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted-foreground">{ip.desc}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {epCount > 0 && (
                <span>
                  {t("detailEpisodeCount", { count: epCount })} · {totalRuntime(episodes)}
                </span>
              )}
              {ip.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {ip.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sentinel — when this scrolls past the top, sticky bar appears */}
        <div ref={heroSentinelRef} aria-hidden className="absolute bottom-12 h-px w-px" />
      </section>

      {/* ── Sticky action bar (after hero) ─────────────── */}
      <div
        className={cn(
          "sticky top-14 z-30 border-b border-border bg-background/85 backdrop-blur transition-all duration-200",
          showStickyBar
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        )}
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-6 py-2.5">
          {ip.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ip.cover} alt="" className="size-9 shrink-0 rounded-md object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {ip.title || t("detailUntitled")}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1", stage.badge.split(" ")[0])}>
                <StageIcon className="size-3" />
                {t(stage.labelKey)}
              </span>
              {epCount > 0 && <span>· {t("detailEpisodeCount", { count: epCount })}</span>}
            </div>
          </div>
          <Button size="sm">
            <IconPlayerPlay className="size-3.5" />
            {t(STAGE_CTA_KEY[ip.stage])}
          </Button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────── */}
      <div className="mx-auto max-w-screen-lg px-6 pt-8 pb-16">
        <div className="space-y-12">
          {/* Episodes — hero of the page */}
          <Section
            icon={<IconPlaylist className="size-5 text-primary" />}
            title={t("detailEpisodesTitle")}
            count={epCount}
          >
            {epCount > 0 ? (
              <EpisodeGrid episodes={episodes} />
            ) : (
              <EmptyState
                message={t("detailNoEpisodes")}
                ctaLabel={t("detailManageEpisodes")}
                ctaHref={`/ips/${id}/edit?tab=episodes`}
              />
            )}
          </Section>

          {/* About */}
          {aboutBody && (
            <Section
              icon={<IconBolt className="size-5 text-amber-400" />}
              title={t("detailAboutTitle")}
            >
              <Prose text={aboutBody} />
            </Section>
          )}

          {/* Team */}
          {ip.team.length > 0 && (
            <Section
              icon={<IconUsers className="size-5 text-violet-400" />}
              title={t("detailCreativeTeam")}
              count={ip.team.length}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ip.team.map((member) => (
                  <div
                    key={member.name}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-base">
                      {member.avatar?.startsWith("http") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={member.avatar} alt="" className="size-full object-cover" />
                      ) : (
                        member.avatar || member.name?.[0] || "?"
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {member.name}
                        </span>
                        {member.level && (
                          <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                            {member.level}
                          </span>
                        )}
                        {member.certified && <IconCircleCheck className="size-3 text-green-400" />}
                      </div>
                      <div className="text-xs text-primary">{member.role}</div>
                      {(member.projects > 0 || member.rating > 0) && (
                        <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                          {member.projects > 0 && (
                            <span>
                              {member.projects} {t("detailProjects")}
                            </span>
                          )}
                          {member.rating > 0 && (
                            <span className="flex items-center gap-0.5">
                              <IconStar className="size-2.5 fill-accent text-accent" />
                              {member.rating}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Updates */}
          {ip.updates.length > 0 && (
            <Section
              icon={<IconBolt className="size-5 text-amber-400" />}
              title={t("sectionUpdates")}
            >
              <div className="space-y-3">
                {ip.updates.map((update, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 text-xs text-muted-foreground">{update.date}</div>
                    <h4 className="mb-1 text-sm font-medium text-foreground">{update.title}</h4>
                    <p className="text-xs leading-relaxed text-secondary-foreground">
                      {update.content}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* FAQ */}
          {ip.faqs.length > 0 && (
            <Section
              icon={<IconMessageCircle className="size-5 text-cyan-400" />}
              title={t("sectionFAQ")}
            >
              <FaqList faqs={ip.faqs} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {typeof count === "number" && count > 0 && (
          <span className="text-xs text-muted-foreground">({count})</span>
        )}
      </div>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-secondary-foreground">
          {p}
        </p>
      ))}
    </div>
  );
}

function EpisodeGrid({ episodes }: { episodes: Episode[] }) {
  const t = useTranslations("ip");
  const [featured, ...rest] = episodes;
  return (
    <div className="space-y-3">
      {/* Featured / first episode */}
      {featured && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_3fr]">
          <div className="relative aspect-video overflow-hidden rounded-xl bg-muted/40">
            {featured.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={featured.cover} alt="" className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center">
                <IconPlaylist className="size-10 text-muted-foreground/30" />
              </div>
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent" />
            <button
              type="button"
              className="absolute inset-0 m-auto inline-flex size-14 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-colors hover:bg-primary"
              aria-label={t("detailPlay")}
            >
              <IconPlayerPlay className="size-6" />
            </button>
            {featured.duration > 0 && (
              <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {formatDuration(featured.duration)}
              </span>
            )}
          </div>
          <div className="flex flex-col justify-center">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground">
              EP {String(featured.sort || 1).padStart(2, "0")}
            </span>
            <h3 className="mt-1 font-heading text-lg font-bold text-foreground">
              {featured.title}
            </h3>
            {featured.description && (
              <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">
                {featured.description}
              </p>
            )}
            <Button size="sm" className="mt-3 self-start">
              <IconPlayerPlay className="size-3.5" />
              {t("detailPlay")}
            </Button>
          </div>
        </div>
      )}

      {/* Remaining episodes */}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((ep, i) => (
            <button type="button" key={ep.id || i} className="group block text-left">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted/40">
                {ep.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ep.cover}
                    alt=""
                    className="size-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <IconPlaylist className="size-6 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  EP {String(ep.sort || i + 2).padStart(2, "0")}
                </div>
                {ep.duration > 0 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium text-white">
                    {formatDuration(ep.duration)}
                  </span>
                )}
              </div>
              <div className="mt-1.5 line-clamp-1 text-xs font-medium text-foreground">
                {ep.title}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  message,
  ctaLabel,
  ctaHref,
}: {
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
      <IconPlaylist className="mx-auto mb-3 size-8 text-muted-foreground/40" />
      <p className="mb-3 text-sm text-muted-foreground">{message}</p>
      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}

function FaqList({ faqs }: { faqs: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {faqs.map((faq, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
          >
            <span className="text-sm font-medium text-foreground">{faq.q}</span>
            <IconChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open === i && "rotate-180"
              )}
            />
          </button>
          {open === i && (
            <div className="px-4 pb-4">
              <p className="text-xs leading-relaxed text-secondary-foreground">{faq.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
