"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VideoPlayer } from "@/components/media/video-player";
import {
  IconArrowLeft,
  IconBolt,
  IconBookmark,
  IconChevronDown,
  IconCircleCheck,
  IconHeart,
  IconLoader2,
  IconMessageCircle,
  IconPlayerPlay,
  IconPlaylist,
  IconShare,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { env } from "@/src/env";
import { mockIPDetailContent } from "@/app/(site)/ips/_data/ip-mock";
import {
  useProjectDetail,
  useProjectVideoLink,
  useProjectMembers,
  useProjectJobs,
  useProjectEpisodes,
  useFAQs,
  type Episode,
} from "@/app/(site)/ips/_hooks/use-ip";

// ─── Detail-page rendering types ─────────────────────
// Composed view: backend reads (project / members / episodes / FAQs) +
// per-field mock fallback for not-yet-shipped fields (story / whyThisIP
// / updates / tagline). Narrow to what the page actually renders.

interface IPTeamMember {
  name: string;
  role: string;
  avatar: string;
  level: string;
  projects: number;
  rating: number;
  certified?: boolean;
}

interface IPUpdate {
  date: string;
  title: string;
  content: string;
}

interface IPFAQ {
  q: string;
  a: string;
}

interface IPDetail {
  id: string;
  title: string;
  cover: string;
  tagline: string;
  story: string;
  whyThisIP: string;
  tags: string[];
  team: IPTeamMember[];
  updates: IPUpdate[];
  faqs: IPFAQ[];
}

const EMPTY_IP_DETAIL: IPDetail = {
  id: "",
  title: "",
  cover: "",
  tagline: "",
  story: "",
  whyThisIP: "",
  tags: [],
  team: [],
  updates: [],
  faqs: [],
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
  const { data: episodes = [] } = useProjectEpisodes(id);
  const { data: faqs = [] } = useFAQs(id);

  // Mock content for fields the backend doesn't expose yet (story copy,
  // hero key art, weekly updates). Per-field fallback so real values
  // override mock without flicker once each backend field lands.
  const mock = mockIPDetailContent(id);

  // Cinema hero pin: once the hero scrolls out of view, surface a compact
  // sticky action bar so the primary CTA is always reachable.
  const heroSentinelRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
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
    tagline: project?.description || mock.tagline,
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
    faqs: faqs.length > 0 ? faqs.map((f) => ({ q: f.question, a: f.answer })) : mock.faqs,
  };

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
      {/* ── Top toolbar ─────────────────────────────────── */}
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 pt-6">
        <Link
          href="/ips"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          {t("detailBackToPlaza")}
        </Link>
        <Link
          href={`/ips/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          {t("detailManage")}
        </Link>
      </div>

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
            {epCount > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {t("detailEpisodeCount", { count: epCount })}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" color="muted">
            <IconBookmark className="size-3.5" />
            {t("detailFollow")}
          </Button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────── */}
      <div className="mx-auto max-w-screen-2xl px-6 pt-12 pb-16">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10">
          <div className="min-w-0 space-y-8">
            {/* Trailer player — Video.js v8 with `fluid: true` locks the
              wrapper to the video's intrinsic aspect ratio. */}
            {hasTrailer ? (
              <VideoPlayer
                src={trailerSrc}
                autoplay={false}
                className="overflow-hidden rounded-2xl ring-1 ring-border/50"
              />
            ) : (
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-border/50">
                {ip.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ip.cover} alt={ip.title} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <IconPlaylist className="size-12 text-muted-foreground/30" />
                  </div>
                )}
              </div>
            )}

            {/* Title + meta + CTAs */}
            <div className="space-y-3">
              <div>
                <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
                  {ip.title || t("detailUntitled")}
                </h1>
                {ip.tagline && <p className="mt-1.5 text-sm text-muted-foreground">{ip.tagline}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {epCount > 0 && (
                  <>
                    <span>{t("detailEpisodeCount", { count: epCount })}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{totalRuntime(episodes)}</span>
                  </>
                )}
              </div>
              {ip.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {ip.tags.slice(0, 6).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] text-primary"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="outline" color="muted">
                  <IconBookmark className="size-4" />
                  {t("detailFollow")}
                </Button>
                <Button variant="ghost" color="muted" size="icon-sm" aria-label={t("share")}>
                  <IconShare className="size-4" />
                </Button>
                <Button variant="ghost" color="muted" size="icon-sm" aria-label={t("detailLike")}>
                  <IconHeart className="size-4" />
                </Button>
              </div>
              {/* Sentinel for sticky action bar */}
              <div ref={heroSentinelRef} aria-hidden className="h-px w-px" />
            </div>

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
                          {member.certified && (
                            <IconCircleCheck className="size-3 text-green-400" />
                          )}
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

          {/* ── Right column: Episodes ────────────────── */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <EpisodesSidebar
              episodes={episodes}
              ipId={id}
              totalRuntime={totalRuntime(episodes)}
              t={t}
            />
          </aside>
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

function EpisodesSidebar({
  episodes,
  ipId,
  totalRuntime,
  t,
}: {
  episodes: Episode[];
  ipId: string;
  totalRuntime: string;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{t("detailEpisodesTitle")}</h2>
          {episodes.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t("detailEpisodeCount", { count: episodes.length })} · {totalRuntime}
            </p>
          )}
        </div>
        <Link
          href={`/ips/${ipId}/edit?tab=episodes`}
          className="rounded-md text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("detailManage")}
        </Link>
      </div>

      {/* List */}
      {episodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <IconPlaylist className="size-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">{t("detailNoEpisodes")}</p>
          <Link
            href={`/ips/${ipId}/edit?tab=episodes`}
            className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70"
          >
            {t("detailManageEpisodes")}
          </Link>
        </div>
      ) : (
        <div className="max-h-[640px] divide-y divide-border/40 overflow-y-auto">
          {episodes.map((ep, i) => (
            <button
              key={ep.id || i}
              type="button"
              className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/40"
            >
              {/* Thumb */}
              <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted/40">
                {ep.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ep.cover} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <IconPlaylist className="size-4 text-muted-foreground/30" />
                  </div>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconPlayerPlay className="size-5 text-white drop-shadow" />
                </span>
                {ep.duration > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-px text-[9px] font-medium text-white">
                    {formatDuration(ep.duration)}
                  </span>
                )}
              </div>

              {/* Title + EP marker */}
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10px] font-semibold tabular-nums tracking-wider text-muted-foreground">
                  EP {String(ep.sort || i + 1).padStart(2, "0")}
                </div>
                <div className="mt-0.5 line-clamp-2 text-xs font-medium text-foreground">
                  {ep.title}
                </div>
              </div>
            </button>
          ))}
        </div>
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
