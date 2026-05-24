"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VideoPlayer } from "@/components/media/video-player";
import {
  IconArrowLeft,
  IconBook,
  IconBookmark,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconEdit,
  IconEye,
  IconHeart,
  IconHeartFilled,
  IconLoader2,
  IconMessageCircle,
  IconPlaylist,
  IconShare,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { fakePlayCount, formatCompactCount } from "@/app/(site)/ips/[id]/_data/fake-play-count";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTagList } from "@/src/hooks/use-tag-list";
import { cn } from "@/lib/utils";
import { env } from "@/src/env";
import { UserAvatar } from "@/components/user-avatar";
import {
  useProjectDetail,
  useProjectVideoLink,
  useProjectMembers,
  useProjectEpisodes,
  useFAQs,
  useProjectEditUrl,
  useEpisodeVideoLink,
  useLegacyJobsByRole,
  ipImageUrl,
  parseTagIds,
  resolveTagNames,
  type Episode,
} from "@/app/(site)/ips/_hooks/use-ip";
import {
  useIpLikeCount,
  useIpLikeStatus,
  useToggleIpLike,
} from "@/app/(site)/ips/_hooks/use-ip-like";
import type { ProjectJob } from "@/app/(site)/ips/_hooks/types";
import { BundleHeroCta, EpisodePaywallChip, PreviewModeBar, PricingProvider } from "./paywall";

interface IPTeamMember {
  userId?: number;
  name: string;
  role: string;
  avatar: string;
  certified?: boolean;
}

interface IPFAQ {
  q: string;
  a: string;
}

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

export function IPDetailClient({ id }: { id: string }) {
  const t = useTranslations("ip");
  const locale = useLocale();

  const { data: project, isLoading } = useProjectDetail(id);
  const { data: videoLink } = useProjectVideoLink(id, !!project?.videoLink);
  const { data: members } = useProjectMembers(id);
  const { data: episodes = [] } = useProjectEpisodes(id);
  const pricingEpisodeIds = useMemo(() => episodes.map((episode) => episode.id), [episodes]);
  const { data: faqs = [] } = useFAQs(id);
  // Legacy job-recruitment compat — when the old `/project/job/project/list`
  // endpoint returns rows for this project's roleId, surface a "岗位招聘"
  // tab so users with historical postings can still see them. Brand-new
  // projects never have legacy data so this stays an empty array and the
  // tab is hidden.
  const { data: legacyJobs = [] } = useLegacyJobsByRole(id);

  const currentUserId = useCurrentUser().user?.id;
  const isOwner =
    !!currentUserId && project?.ownerId != null && String(project.ownerId) === currentUserId;
  const editUrl = useProjectEditUrl(id);

  // Section-nav scrollspy state. Active key is set on click; intersection
  // observer keeps it in sync as the user scrolls naturally.
  const [activeSection, setActiveSection] = useState<string>("story");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Currently-playing episode. `null` = no episode picked yet, player
  // falls back to the project trailer (`videoLink`). Resolution of the
  // playable URL is async and goes through `/vedio/play/getLink` (the
  // wire `videoLink` on the episode is an internal OSS key, not directly
  // playable from the browser).
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const { data: episodePlayUrl, isFetching: episodeUrlLoading } = useEpisodeVideoLink(
    selectedEpisodeId ?? "",
    !!selectedEpisodeId
  );

  // Tags come back as `JSON.stringify(numericIds[])` from `/project/query`.
  // Translate IDs → display names via the shared tag taxonomy so chips
  // read e.g. "#Animation" instead of the raw "#11" they used to.
  const { data: tagOptions = [] } = useTagList();
  const tagMap = useMemo(() => new Map(tagOptions.map((tag) => [tag.id, tag.name])), [tagOptions]);
  const realTags: string[] = useMemo(
    () => resolveTagNames(parseTagIds(project?.tag), tagMap),
    [project?.tag, tagMap]
  );
  const team: IPTeamMember[] = (Array.isArray(members) ? members : []).map((m) => {
    const role =
      m.role === 10 ? "Owner" : m.role === 8 ? "Admin" : m.roleName || m.remark || "Member";
    return {
      userId: m.userId ?? undefined,
      name: m.nickName || m.userName || "Member",
      role,
      avatar: m.avatar ? `${env.USER_BASE_URL || env.OSS_BASE_URL}/${m.avatar}` : "",
    };
  });
  const ipFaqs: IPFAQ[] = faqs.map((f) => ({ q: f.question, a: f.answer }));

  const title = project?.name ?? "";
  const tagline = project?.description ?? "";
  const story = project?.background ?? "";
  const cover = project?.bannerLink
    ? project.bannerLink.startsWith("http")
      ? project.bannerLink
      : `${env.BANNER_BASE_URL}/${project.bannerLink}`
    : "";

  // Sections only render when data exists; the nav mirrors the same set so
  // we never link to an empty anchor.
  const sections: { key: string; label: string }[] = [
    story ? { key: "story", label: t("detailStoryTitle") } : null,
    team.length > 0 ? { key: "team", label: t("detailCreativeTeam") } : null,
    legacyJobs.length > 0 ? { key: "jobs", label: t("detailJobRecruitment") } : null,
    ipFaqs.length > 0 ? { key: "faq", label: t("sectionFAQ") } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target instanceof HTMLElement) {
          const key = visible.target.dataset.sectionKey;
          if (key) setActiveSection(key);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [sections.length]);

  const scrollToSection = (key: string) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const trailerSrc = videoLink ?? "";
  // Selected episode wins; trailer is the fallback. While the episode
  // play link is being resolved we briefly show no src — the player
  // shows a spinner overlay (see below) so the user knows the click
  // landed.
  const playerSrc = selectedEpisodeId ? (episodePlayUrl ?? "") : trailerSrc;
  const hasTrailer = !!trailerSrc;

  return (
    <PricingProvider ipId={id} episodeIds={pricingEpisodeIds} isOwner={isOwner}>
      <div className="min-h-screen bg-background">
        {/* Preview-mode top bar — only renders when ?preview=pricing.
            Sticky so identity switcher stays reachable while scrolling. */}
        <PreviewModeBar />

        {/* Back link */}
        <div className="mx-auto max-w-screen-2xl px-6 pt-4">
          <Link
            href="/ips"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-4" />
            {t("detailBackToPlaza")}
          </Link>
        </div>

        {/* Hero */}
        <div className="mx-auto max-w-screen-2xl px-6 py-6">
          <div className="mb-8 text-center">
            <div className="relative">
              <h1 className="mb-2 text-4xl font-bold text-foreground">
                {title || t("detailUntitled")}
              </h1>
              {isOwner && (
                <Link
                  href={editUrl}
                  className="absolute right-0 top-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                  aria-label={t("detailEditIp")}
                >
                  <IconEdit className="size-3.5" />
                  {t("detailEditIp")}
                </Link>
              )}
            </div>
            {tagline && <p className="mb-3 text-sm text-muted-foreground">{tagline}</p>}
            {/* Lifecycle status is intentionally NOT shown on this
              consumer-facing detail page. The previous badge claimed
              "Released" for `projectStatus === 0`, which under the
              real 4-state model (0=pending / 3=rejected / 5=approved /
              8=offline) is the *pending review* state — exactly the
              opposite of "released". The owner sees the correct badge
              on the edit page; consumers don't need lifecycle info. */}
            {realTags.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {realTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Bundle hero — top-of-page CTA for the "buy whole IP" offer.
          Renders nothing when the paywall is inactive or the creator
          didn't enable a bundle, so the layout stays unchanged for
          free IPs. */}
        <div className="mx-auto max-w-screen-2xl px-6 pb-2">
          <BundleHeroCta />
        </div>

        {/* Two-column body */}
        <div className="mx-auto max-w-screen-2xl px-6 pb-12">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            {/* LEFT */}
            <div className="space-y-8 lg:col-span-2">
              {/* Trailer / cover */}
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-secondary">
                {playerSrc ? (
                  <VideoPlayer
                    // Force remount when src swaps episodes — video.js
                    // doesn't reliably reload mid-playback otherwise.
                    key={playerSrc}
                    src={playerSrc}
                    autoplay={!!selectedEpisodeId}
                    className="size-full"
                  />
                ) : cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt={title} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <IconPlaylist className="size-12 text-muted-foreground/30" />
                  </div>
                )}
                {/* Episode-link resolution spinner. Shown only while the
                  user just clicked Play and we're awaiting
                  /vedio/play/getLink — the underlying VideoPlayer is
                  unmounted (no src yet) so a separate overlay is the
                  only progress signal. */}
                {selectedEpisodeId && episodeUrlLoading && !episodePlayUrl && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
                    <IconLoader2 className="size-7 animate-spin text-white/80" />
                  </div>
                )}
              </div>

              {/* Sticky section nav */}
              {sections.length > 0 && (
                <div className="sticky top-14 z-40 -mx-6 border-b border-border bg-background px-6">
                  <div className="flex items-center gap-0 overflow-x-auto">
                    {sections.map((section) => (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => scrollToSection(section.key)}
                        className={cn(
                          "shrink-0 border-b-2 px-5 py-3 text-sm font-medium transition-colors",
                          activeSection === section.key
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Story */}
              {story && (
                <div
                  data-section-key="story"
                  ref={(el) => {
                    sectionRefs.current.story = el;
                  }}
                >
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                    <IconBook className="size-5 text-primary" />
                    {t("detailStoryTitle")}
                  </h2>
                  <Prose text={story} />
                </div>
              )}

              {/* Creative Team */}
              {team.length > 0 && (
                <div
                  data-section-key="team"
                  ref={(el) => {
                    sectionRefs.current.team = el;
                  }}
                >
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                    <IconUsers className="size-5 text-purple-400" />
                    {t("detailCreativeTeam")}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {team.map((member, idx) => {
                      const cardClass =
                        "flex items-start gap-3 rounded-xl border border-border bg-card p-4";
                      const inner = (
                        <>
                          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-lg">
                            {member.avatar?.startsWith("http") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={member.avatar} alt="" className="size-full object-cover" />
                            ) : (
                              (member.name?.[0] ?? "?").toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="mb-0.5 flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-foreground">
                                {member.name}
                              </span>
                              {member.certified && (
                                <IconCircleCheck className="size-3 text-green-400" />
                              )}
                            </div>
                            <div className="text-xs text-primary">{member.role}</div>
                          </div>
                        </>
                      );
                      return member.userId ? (
                        <Link
                          key={member.userId}
                          href={`/creators/${member.userId}`}
                          className={`${cardClass} transition-colors hover:border-primary/40 hover:bg-card/80`}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div key={`${member.name}-${idx}`} className={cardClass}>
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Legacy job recruitment — only rendered when historical
                data exists for this project. See useLegacyJobsByRole. */}
              {legacyJobs.length > 0 && (
                <div
                  data-section-key="jobs"
                  ref={(el) => {
                    sectionRefs.current.jobs = el;
                  }}
                >
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                    <IconBookmark className="size-5 text-amber-400" />
                    {t("detailJobRecruitment")}
                  </h2>
                  <LegacyJobsList jobs={legacyJobs} t={t} />
                </div>
              )}

              {/* FAQ */}
              {ipFaqs.length > 0 && (
                <div
                  data-section-key="faq"
                  ref={(el) => {
                    sectionRefs.current.faq = el;
                  }}
                >
                  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                    <IconMessageCircle className="size-5 text-cyan-400" />
                    {t("sectionFAQ")}
                  </h2>
                  <FaqList faqs={ipFaqs} />
                </div>
              )}
            </div>

            {/* RIGHT */}
            <div>
              <div className="space-y-4 lg:sticky lg:top-28">
                {team.length > 0 && <RailTeam team={team} t={t} />}
                <ReleasedPanel
                  episodes={episodes}
                  runtime={totalRuntime(episodes)}
                  editUrl={editUrl}
                  isOwner={isOwner}
                  selectedEpisodeId={selectedEpisodeId}
                  onSelectEpisode={(epId) => {
                    setSelectedEpisodeId(epId);
                    // Bring the player back into view on small/medium
                    // screens — the right rail sits below the player on
                    // mobile so a click would otherwise scroll nothing.
                    if (typeof window !== "undefined") {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                  t={t}
                  locale={locale}
                />
                <RailShare title={title} projectId={id} t={t} />
                <RailProducer
                  ownerId={project?.ownerId}
                  name={project?.ownerName ?? ""}
                  avatar={project?.ownerAvatar ?? ""}
                  t={t}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </PricingProvider>
  );
}

// ─── Subcomponents ───────────────────────────────────

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

function ReleasedPanel({
  episodes,
  runtime,
  editUrl,
  isOwner,
  selectedEpisodeId,
  onSelectEpisode,
  t,
  locale,
}: {
  episodes: Episode[];
  runtime: string;
  editUrl: string;
  isOwner: boolean;
  selectedEpisodeId: string | null;
  onSelectEpisode: (episodeId: string) => void;
  t: ReturnType<typeof useTranslations>;
  locale: string;
}) {
  return (
    <div className="rounded-xl border border-green-400/20 bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <IconCircleCheck className="size-5 text-green-400" />
        <h3 className="text-sm font-bold text-foreground">{t("detailPurchaseWatch")}</h3>
      </div>

      {episodes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-secondary/40 px-4 py-8 text-center">
          <IconPlaylist className="size-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">{t("detailNoEpisodes")}</p>
          {isOwner && (
            <a
              href={editUrl}
              className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70"
            >
              {t("detailManageEpisodes")}
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="mb-3 text-[11px] text-muted-foreground">
            {t("detailEpisodeCount", { count: episodes.length })} · {runtime}
          </p>
          <div className="space-y-2">
            {episodes.map((ep, i) => {
              const epId = ep.id ? String(ep.id) : "";
              const isPlaying = !!epId && epId === selectedEpisodeId;
              const plays = fakePlayCount(epId || i, ep.createdAt);
              const epDuration = ep.duration > 0 ? formatDuration(ep.duration) : "";
              return (
                <div
                  key={epId || i}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg p-2.5 transition-colors",
                    isPlaying ? "bg-primary/15 ring-1 ring-primary/40" : "bg-secondary/50"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                        isPlaying
                          ? "bg-primary/30 text-primary"
                          : "bg-secondary text-muted-foreground"
                      )}
                    >
                      {String(ep.videoNumber || i + 1).padStart(2, "0")}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "truncate text-xs",
                          isPlaying ? "font-medium text-primary" : "text-foreground"
                        )}
                      >
                        {ep.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <IconEye className="size-3" />
                        <span>{formatCompactCount(plays, locale)}</span>
                        {epDuration && (
                          <>
                            <span className="opacity-60">·</span>
                            <span>{epDuration}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Paywall-aware action: renders the lock CTA when
                      this episode is gated, ✓ play tint when the
                      viewer already owns it, otherwise the original
                      compact play button. Drop-in dimension match —
                      the row layout doesn't shift between modes. */}
                  <EpisodePaywallChip
                    episodeId={epId}
                    episodeTitle={ep.title}
                    episodeNumber={ep.videoNumber || i + 1}
                    isPlaying={isPlaying}
                    onPlay={() => epId && onSelectEpisode(epId)}
                    playLabel={t("detailPlay")}
                    nowPlayingLabel={t("detailNowPlaying")}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function RailTeam({ team, t }: { team: IPTeamMember[]; t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{t("detailCreativeTeam")}</h3>
      <div className="space-y-3">
        {team.map((member, idx) => {
          const rowClass = "flex items-center gap-3";
          const inner = (
            <>
              <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm">
                {member.avatar?.startsWith("http") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={member.avatar} alt="" className="size-full object-cover" />
                ) : (
                  (member.name?.[0] ?? "?").toUpperCase()
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">
                    {member.name}
                  </span>
                  {member.certified && <IconCircleCheck className="size-3 text-green-400" />}
                </div>
                <span className="text-[10px] text-muted-foreground">{member.role}</span>
              </div>
            </>
          );
          return member.userId ? (
            <Link
              key={member.userId}
              href={`/creators/${member.userId}`}
              className={`${rowClass} -mx-1 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/40`}
            >
              {inner}
            </Link>
          ) : (
            <div key={`${member.name}-${idx}`} className={rowClass}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RailShare({
  title,
  projectId,
  t,
}: {
  title: string;
  projectId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [copied, setCopied] = useState(false);
  const handleShare = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied — silent noop. */
    }
  };

  // Like is wired to `/project/like/{id}` + matching unlike. Status
  // and count fetch independently so the heart paints from `liked`
  // (per-user) and the chip from `count` (global) — both update
  // optimistically on click and roll back on backend failure.
  const { data: liked = false } = useIpLikeStatus(projectId);
  const { data: likeCount = 0 } = useIpLikeCount(projectId);
  const toggleLike = useToggleIpLike(projectId);
  const likeBusy = toggleLike.isPending;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{t("detailShare")}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t("detailShareHint", { title })}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleShare}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-2 text-xs text-foreground transition-colors hover:bg-secondary/80"
        >
          {copied ? (
            <>
              <IconCircleCheck className="size-3.5 text-green-400" />
              {t("detailShareCopied")}
            </>
          ) : (
            <>
              <IconShare className="size-3.5" />
              {t("detailShare")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => toggleLike.mutate(liked)}
          disabled={likeBusy}
          aria-pressed={liked}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs transition-colors disabled:cursor-wait",
            liked
              ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
              : "bg-secondary text-foreground hover:bg-secondary/80"
          )}
        >
          {liked ? <IconHeartFilled className="size-3.5" /> : <IconHeart className="size-3.5" />}
          <span className="tabular-nums">{likeCount > 0 ? likeCount : t("detailLike")}</span>
        </button>
        {/* Follow stays disabled until backend ships the bookmark
            endpoint family — visual placeholder so the rail layout
            doesn't shift when it lands. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="flex flex-1 cursor-not-allowed items-center justify-center gap-1 rounded-lg bg-secondary/50 py-2 text-xs text-muted-foreground"
        >
          <IconBookmark className="size-3.5" />
          {t("detailFollow")}
        </button>
      </div>
    </div>
  );
}

function RailProducer({
  ownerId,
  name,
  avatar,
  t,
}: {
  ownerId: string | number | undefined;
  name: string;
  avatar: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!name && !avatar) return null;
  const avatarUrl = avatar
    ? avatar.startsWith("http")
      ? avatar
      : `${env.USER_BASE_URL || env.OSS_BASE_URL}/${avatar}`
    : "";
  const href = ownerId != null ? `/profile/${ownerId}` : "#";
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30"
    >
      <h3 className="mb-3 text-sm font-semibold text-foreground">{t("detailProducer")}</h3>
      <div className="flex items-center gap-3">
        <UserAvatar src={avatarUrl} seed={ownerId} name={name} className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{name || "—"}</div>
          <span className="text-xs text-muted-foreground">{t("detailProducerLabel")}</span>
        </div>
        <IconChevronRight className="size-4 text-muted-foreground" />
      </div>
    </Link>
  );
}

/**
 * Renders legacy job postings returned by the old
 * `/project/job/project/list` endpoint. Kept intentionally minimal —
 * we have no design for this surface, the goal is just to *expose* the
 * historical data so users with old projects don't lose visibility.
 * Field shape per `ProjectJob` in `_hooks/types.ts`.
 */
function LegacyJobsList({
  jobs,
  t,
}: {
  jobs: ProjectJob[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="space-y-2">
      {jobs.map((job, i) => {
        const title = job.roleName || `#${job.roleId ?? i + 1}`;
        const desc = typeof job.jobDescription === "string" ? job.jobDescription.trim() : "";
        const profitParts: string[] = [];
        if (typeof job.profitRatio === "number" && job.profitRatio > 0) {
          profitParts.push(t("detailJobProfitRatio", { ratio: job.profitRatio }));
        }
        if (typeof job.estimatedEarnings === "number" && job.estimatedEarnings > 0) {
          profitParts.push(t("detailJobEstimatedEarnings", { amount: job.estimatedEarnings }));
        }
        return (
          <div key={job.id ?? i} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {profitParts.length > 0 && (
                <span className="shrink-0 text-[11px] text-amber-400">
                  {profitParts.join(" · ")}
                </span>
              )}
            </div>
            {desc && (
              <p className="text-xs leading-relaxed text-secondary-foreground whitespace-pre-line">
                {desc}
              </p>
            )}
          </div>
        );
      })}
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
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary"
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
