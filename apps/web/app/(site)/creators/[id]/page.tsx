"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  IconArrowLeft,
  IconStarFilled,
  IconBriefcase,
  IconClock,
  IconMessage,
  IconHeart,
  IconHeartFilled,
  IconBookmark,
  IconBookmarkFilled,
  IconShare,
  IconUsers,
  IconMovie,
  IconExternalLink,
  IconX,
  IconMapPin,
  IconWorld,
  IconFileText,
  IconMessageCircle,
  IconCalendar,
  IconBuilding,
  IconUserPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  useCreatorDetail,
  useIsLiked,
  useIsSaved,
  useLikeCreator,
  useSaveCreator,
  useInviteCreatorToCrew,
  useContactCreator,
  LEVEL_COLORS,
  AVAILABILITY_CONFIG,
} from "@/app/(site)/creators/_hooks/use-creator";

const SKILL_PALETTE = [
  "border-red-400/30 bg-red-400/10 text-red-400",
  "border-violet-400/30 bg-violet-400/10 text-violet-400",
  "border-blue-400/30 bg-blue-400/10 text-blue-400",
  "border-amber-400/30 bg-amber-400/10 text-amber-400",
  "border-green-400/30 bg-green-400/10 text-green-400",
  "border-pink-400/30 bg-pink-400/10 text-pink-400",
];

type Tab = "overview" | "portfolio" | "reviews";

export default function CreatorDetailPage() {
  const t = useTranslations("creator");
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showContact, setShowContact] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const { data: creator, isLoading } = useCreatorDetail(id);
  const { data: liked } = useIsLiked(id);
  const { data: saved } = useIsSaved(id);
  const likeMutation = useLikeCreator(id);
  const saveMutation = useSaveCreator(id);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-bold text-foreground">{t("notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notFoundDesc")}</p>
        <Link
          href="/creators"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <IconArrowLeft className="size-4" /> {t("back")}
        </Link>
      </div>
    );
  }

  const levelStyle = LEVEL_COLORS[creator.level];
  const avail = AVAILABILITY_CONFIG[creator.availability];
  const availText =
    avail.label === "Available Now"
      ? t("availableNow")
      : avail.label === "This Week"
        ? t("thisWeek")
        : t("byAppointment");

  const handleLike = () => {
    likeMutation.mutate(undefined, {
      onSuccess: ({ liked: isLikedNow }) => toast.success(isLikedNow ? t("tLiked") : t("tUnliked")),
      onError: () => toast.error(t("tFailed")),
    });
  };

  const handleSave = () => {
    saveMutation.mutate(undefined, {
      onSuccess: ({ saved: isSavedNow }) => toast.success(isSavedNow ? t("tSaved") : t("tUnsaved")),
      onError: () => toast.error(t("tFailed")),
    });
  };

  const handleShare = () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator
        .share({
          title: creator.name,
          url: typeof window !== "undefined" ? window.location.href : "",
        })
        .catch(() => {});
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      toast.success(t("share") + " ✓");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        {/* Cover montage backdrop */}
        <div className="absolute inset-0">
          {creator.covers[0] && (
            <img
              src={creator.covers[0]}
              alt=""
              aria-hidden
              className="absolute inset-0 size-full object-cover opacity-40"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/85 to-background" />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, hsl(280 60% 55% / 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 30%, hsl(0 78% 52% / 0.12) 0%, transparent 50%)",
            }}
          />
        </div>

        <div className="relative mx-auto max-w-screen-2xl px-6 pb-8 pt-10">
          <Link
            href="/creators"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconArrowLeft className="size-3.5" /> {t("back")}
          </Link>

          <div className="flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
            <div className="flex items-end gap-5">
              {/* Avatar */}
              <div
                className={cn(
                  "flex size-28 shrink-0 items-center justify-center rounded-3xl border-2 border-background bg-gradient-to-br shadow-2xl backdrop-blur-md md:size-32",
                  "from-primary/20 to-violet-500/20"
                )}
              >
                <span className="text-4xl font-black text-foreground">
                  {creator.name.charAt(0)}
                </span>
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-black text-foreground md:text-4xl">
                    {creator.name}
                  </h1>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-xs font-bold ${levelStyle.text} ${levelStyle.bg} ${levelStyle.border}`}
                  >
                    {creator.level}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <IconMapPin className="size-3.5" /> {creator.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <IconWorld className="size-3.5" /> {creator.timezone}
                  </span>
                  {creator.school && (
                    <span className="flex items-center gap-1">
                      <IconBuilding className="size-3.5" /> {creator.school}
                    </span>
                  )}
                  <span className={`flex items-center gap-1 ${avail.text}`}>
                    <span className={`size-1.5 rounded-full ${avail.dot}`} /> {availText}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <IconButton
                onClick={handleLike}
                active={!!liked}
                disabled={likeMutation.isPending}
                icon={
                  liked ? (
                    <IconHeartFilled className="size-4 text-red-400" />
                  ) : (
                    <IconHeart className="size-4" />
                  )
                }
                label={liked ? t("liked") : t("like")}
              />
              <IconButton
                onClick={handleSave}
                active={!!saved}
                disabled={saveMutation.isPending}
                icon={
                  saved ? (
                    <IconBookmarkFilled className="size-4 text-amber-400" />
                  ) : (
                    <IconBookmark className="size-4" />
                  )
                }
                label={saved ? t("saved") : t("save")}
              />
              <IconButton
                onClick={handleShare}
                icon={<IconShare className="size-4" />}
                label={t("share")}
              />
              <button
                type="button"
                onClick={() => setShowContact(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-foreground backdrop-blur-md transition-colors hover:border-white/25 hover:bg-white/[0.1]"
              >
                <IconMessage className="size-4" /> {t("contact")}
              </button>
              <button
                type="button"
                onClick={() => setShowInvite(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-bold text-black shadow-lg transition-transform hover:scale-[1.02]"
              >
                <IconUserPlus className="size-4" /> {t("invite")}
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={IconBriefcase} label={t("projects")} value={String(creator.projects)} />
            <StatCard
              icon={IconStarFilled}
              label={t("rating")}
              value={String(creator.rating)}
              accent="text-amber-400"
            />
            <StatCard
              icon={IconMessageCircle}
              label={t("reviewsLabel")}
              value={String(creator.reviews)}
            />
            <StatCard icon={IconClock} label={t("responseTime")} value={creator.responseTime} />
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────── */}
      <div className="mx-auto max-w-screen-2xl px-6 pb-16">
        {/* Tabs */}
        <div className="mb-6 flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1 backdrop-blur-md">
          <TabBtn active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
            <IconUsers className="size-4" />
            {t("tabOverview")}
          </TabBtn>
          <TabBtn active={activeTab === "portfolio"} onClick={() => setActiveTab("portfolio")}>
            <IconFileText className="size-4" />
            {t("tabPortfolio")}{" "}
            <Counter active={activeTab === "portfolio"} count={creator.portfolio.length} />
          </TabBtn>
          <TabBtn active={activeTab === "reviews"} onClick={() => setActiveTab("reviews")}>
            <IconMessageCircle className="size-4" />
            {t("tabReviews")}{" "}
            <Counter active={activeTab === "reviews"} count={creator.reviewList.length} />
          </TabBtn>
        </div>

        {activeTab === "overview" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* About */}
            <div className="lg:col-span-2">
              <Section title={t("tabOverview")}>
                <p className="text-sm leading-relaxed text-foreground/85">{creator.fullBio}</p>
              </Section>

              {/* Skills */}
              <Section title={t("skills")} className="mt-5">
                <div className="flex flex-wrap gap-2">
                  {creator.skills.map((skill, i) => (
                    <span
                      key={skill}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        SKILL_PALETTE[i % SKILL_PALETTE.length]
                      )}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </Section>

              {/* Studio history */}
              {creator.studioHistory.length > 0 && (
                <Section title={t("studioHistory")} className="mt-5">
                  <ol className="relative space-y-4 border-l border-white/10 pl-5">
                    {creator.studioHistory.map((entry, i) => (
                      <li key={i} className="relative">
                        <span className="absolute -left-[27px] top-1 flex size-3 items-center justify-center rounded-full border border-white/20 bg-background">
                          <span className="size-1.5 rounded-full bg-primary" />
                        </span>
                        <div className="text-xs uppercase tracking-wider text-muted-foreground">
                          {entry.period}
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-foreground">
                          {entry.role} · {entry.name}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{entry.project}</div>
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-5">
              <Section title={t("involvedIPs")}>
                {creator.ips.length === 0 ? (
                  <p className="text-xs text-muted-foreground">—</p>
                ) : (
                  <div className="space-y-3">
                    {creator.ips.map((ip) => (
                      <div
                        key={ip.title}
                        className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 transition-colors hover:border-white/10"
                      >
                        <img
                          src={ip.cover}
                          alt={ip.title}
                          className="size-12 shrink-0 rounded-lg object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {ip.title}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {ip.role} · {t("episodes", { n: ip.episodes })}
                          </div>
                        </div>
                        <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-[10px] text-blue-400">
                          {ip.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={t("joined")}>
                <div className="flex items-center gap-2 text-sm text-foreground/85">
                  <IconCalendar className="size-4 text-muted-foreground" />
                  {creator.joinedAt}
                </div>
              </Section>
            </div>
          </div>
        )}

        {activeTab === "portfolio" && (
          <div>
            {creator.portfolio.length === 0 ? (
              <EmptyPanel text={t("noPortfolio")} />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {creator.portfolio.map((piece) => (
                  <a
                    key={piece.id}
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    className="group relative block aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
                  >
                    <img
                      src={piece.cover}
                      alt={piece.title}
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-4">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
                        {piece.type}
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-white">{piece.title}</div>
                    </div>
                    <span className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md opacity-0 transition-opacity group-hover:opacity-100">
                      <IconExternalLink className="size-3.5" />
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "reviews" && (
          <div>
            {creator.reviewList.length === 0 ? (
              <EmptyPanel text={t("noReviews")} />
            ) : (
              <div className="space-y-3">
                {creator.reviewList.map((review, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                          {review.author.charAt(0)}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {review.author}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{review.date}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 text-amber-400">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <IconStarFilled
                            key={idx}
                            className={cn(
                              "size-3.5",
                              idx < review.rating ? "" : "text-muted-foreground/20"
                            )}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-foreground/85">{review.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showContact && (
        <ContactDialog
          name={creator.name}
          creatorId={creator.id}
          onClose={() => setShowContact(false)}
        />
      )}
      {showInvite && (
        <InviteDialog
          name={creator.name}
          creatorId={creator.id}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-md",
        className
      )}
    >
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className={cn("text-2xl font-black text-foreground", accent)}>{value}</div>
    </div>
  );
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-medium backdrop-blur-md transition-colors disabled:opacity-50",
        active
          ? "border-white/25 bg-white/[0.08] text-foreground"
          : "border-white/10 bg-white/[0.04] text-muted-foreground hover:border-white/20 hover:bg-white/[0.07] hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all",
        active
          ? "bg-white text-black shadow-sm"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Counter({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
        active ? "bg-black/10 text-black" : "bg-white/10 text-foreground/70"
      )}
    >
      {count}
    </span>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] py-20 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// ─── Dialogs ─────────────────────────────────────────

function DialogShell({
  title,
  desc,
  onClose,
  children,
}: {
  title: string;
  desc: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-background/95 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/5 p-5">
          <div>
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconX className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ContactDialog({
  name,
  creatorId,
  onClose,
}: {
  name: string;
  creatorId: string;
  onClose: () => void;
}) {
  const t = useTranslations("creator");
  const [message, setMessage] = useState("");
  const contact = useContactCreator();

  const submit = () => {
    if (!message.trim()) {
      toast.error(t("fillRequired"));
      return;
    }
    contact.mutate(
      { creatorId, message },
      {
        onSuccess: () => {
          toast.success(t("tMessageSent", { name }));
          onClose();
        },
        onError: () => toast.error(t("tFailed")),
      }
    );
  };

  return (
    <DialogShell title={t("contactTitle")} desc={t("contactDesc", { name })} onClose={onClose}>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("contactMessagePlaceholder")}
        rows={5}
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-md focus:border-white/25 focus:outline-none"
      />
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.08]"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={contact.isPending}
          onClick={submit}
          className="flex-1 rounded-xl bg-white py-2.5 text-sm font-bold text-black shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-50"
        >
          {t("sendMessage")}
        </button>
      </div>
    </DialogShell>
  );
}

function InviteDialog({
  name,
  creatorId,
  onClose,
}: {
  name: string;
  creatorId: string;
  onClose: () => void;
}) {
  const t = useTranslations("creator");
  const [crewId, setCrewId] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const invite = useInviteCreatorToCrew();

  const submit = () => {
    if (!crewId.trim() || !role.trim()) {
      toast.error(t("fillRequired"));
      return;
    }
    invite.mutate(
      { creatorId, crewId, role, message },
      {
        onSuccess: () => {
          toast.success(t("tInviteSent", { name }));
          onClose();
        },
        onError: () => toast.error(t("tFailed")),
      }
    );
  };

  return (
    <DialogShell title={t("inviteTitle")} desc={t("inviteDesc", { name })} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t("inviteCrewLabel")}>
          <input
            value={crewId}
            onChange={(e) => setCrewId(e.target.value)}
            placeholder={t("inviteCrewPlaceholder")}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-md focus:border-white/25 focus:outline-none"
          />
        </Field>
        <Field label={t("inviteRoleLabel")}>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder={t("inviteRolePlaceholder")}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-md focus:border-white/25 focus:outline-none"
          />
        </Field>
        <Field label={t("inviteMessageLabel")}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("inviteMessagePlaceholder")}
            rows={4}
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-md focus:border-white/25 focus:outline-none"
          />
        </Field>
      </div>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.08]"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={invite.isPending}
          onClick={submit}
          className="flex-1 rounded-xl bg-white py-2.5 text-sm font-bold text-black shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-50"
        >
          {t("sendInvite")}
        </button>
      </div>
    </DialogShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
