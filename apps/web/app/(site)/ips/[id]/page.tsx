"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { VideoPlayer } from "@/components/media/video-player";
import {
  IconArrowLeft,
  IconBook,
  IconBookmark,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconHeart,
  IconLoader2,
  IconMessageCircle,
  IconPlayerPlay,
  IconPlaylist,
  IconShare,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import { cn } from "@/lib/utils";
import { env } from "@/src/env";
import {
  useProjectDetail,
  useProjectVideoLink,
  useProjectMembers,
  useProjectEpisodes,
  useFAQs,
  useProjectEditUrl,
  ipImageUrl,
  type Episode,
} from "@/app/(site)/ips/_hooks/use-ip";

interface IPTeamMember {
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

export default function IPDetailPage() {
  const t = useTranslations("ip");
  const { id } = useParams<{ id: string }>();

  const { data: project, isLoading } = useProjectDetail(id);
  const { data: videoLink } = useProjectVideoLink(id, !!project?.videoLink);
  const { data: members } = useProjectMembers(id);
  const { data: episodes = [] } = useProjectEpisodes(id);
  const { data: faqs = [] } = useFAQs(id);

  const currentUserId = useCurrentUser().user?.id;
  const isOwner =
    !!currentUserId && project?.ownerId != null && String(project.ownerId) === currentUserId;
  const editUrl = useProjectEditUrl(id);

  // Section-nav scrollspy state. Active key is set on click; intersection
  // observer keeps it in sync as the user scrolls naturally.
  const [activeSection, setActiveSection] = useState<string>("story");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const realTags: string[] = (() => {
    try {
      const parsed = JSON.parse(project?.tag ?? "[]");
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  })();
  const team: IPTeamMember[] = (Array.isArray(members) ? members : []).map((m) => {
    const role =
      m.role === 10 ? "Owner" : m.role === 8 ? "Admin" : m.roleName || m.remark || "Member";
    return {
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
  const hasTrailer = !!trailerSrc;

  return (
    <div className="min-h-screen bg-background">
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
          <h1 className="mb-2 text-4xl font-bold text-foreground">
            {title || t("detailUntitled")}
          </h1>
          {tagline && <p className="mb-3 text-sm text-muted-foreground">{tagline}</p>}
          <div className="mb-3 flex items-center justify-center gap-3">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-400/10 px-2.5 py-1 text-xs font-medium text-green-400">
              <IconCircleCheck className="size-3.5" />
              {t("detailReleased")}
            </span>
          </div>
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

      {/* Two-column body */}
      <div className="mx-auto max-w-screen-2xl px-6 pb-12">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* LEFT */}
          <div className="space-y-8 lg:col-span-2">
            {/* Trailer / cover */}
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-secondary">
              {hasTrailer ? (
                <VideoPlayer src={trailerSrc} autoplay={false} className="size-full" />
              ) : cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt={title} className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <IconPlaylist className="size-12 text-muted-foreground/30" />
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
                  {team.map((member) => (
                    <div
                      key={member.name}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                    >
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
                    </div>
                  ))}
                </div>
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
                t={t}
              />
              <RailShare title={title} t={t} />
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
  t,
}: {
  episodes: Episode[];
  runtime: string;
  editUrl: string;
  isOwner: boolean;
  t: ReturnType<typeof useTranslations>;
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
            {episodes.map((ep, i) => (
              <div
                key={ep.id || i}
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded bg-secondary text-[10px] font-bold text-muted-foreground">
                    {String(ep.videoNumber || i + 1).padStart(2, "0")}
                  </div>
                  <span className="truncate text-xs text-foreground">{ep.title}</span>
                </div>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  <IconPlayerPlay className="size-3" />
                  {t("detailPlay")}
                </button>
              </div>
            ))}
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
        {team.map((member) => (
          <div key={member.name} className="flex items-center gap-3">
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
                <span className="truncate text-xs font-medium text-foreground">{member.name}</span>
                {member.certified && <IconCircleCheck className="size-3 text-green-400" />}
              </div>
              <span className="text-[10px] text-muted-foreground">{member.role}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RailShare({ title, t }: { title: string; t: ReturnType<typeof useTranslations> }) {
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
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-2 text-xs text-foreground transition-colors hover:bg-secondary/80"
        >
          <IconHeart className="size-3.5" />
          {t("detailLike")}
        </button>
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-secondary py-2 text-xs text-foreground transition-colors hover:bg-secondary/80"
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
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-base font-semibold text-foreground/80">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            (name?.[0] ?? "?").toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{name || "—"}</div>
          <span className="text-xs text-muted-foreground">{t("detailProducerLabel")}</span>
        </div>
        <IconChevronRight className="size-4 text-muted-foreground" />
      </div>
    </Link>
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
