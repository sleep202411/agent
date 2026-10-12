"use client";

/**
 * CreatorLeftRail — identity column under the hero.
 *
 * Owns every static identity surface (business info, bio, education,
 * work experience, certificate trust). Promoting these out of the
 * About tab into the rail lets the right pane stay focused on
 * portfolio-style content (services / works / certificates / IPs /
 * crews) and removes one tab from the bar entirely.
 *
 * Profile, biography and education share the profile editor. Work
 * experience owns its entry editor and deletion confirmation.
 *
 * No `sticky` modifier here: the rail can run longer than the viewport
 * once a creator fills in their resume, and a half-clipped sticky rail
 * reads worse than one that scrolls with the content. The right pane
 * is typically equally tall, so empty space below the rail isn't a
 * concern in practice.
 */
import { CertificationGuide } from "./certification-guide";
import { useMemo, useState, type ReactNode } from "react";
import { encodeUserId } from "@/src/lib/user-id-codec";
import {
  IconCertificate,
  IconCircleCheck,
  IconEdit,
  IconLock,
  IconPlus,
  IconSchool,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { parseEducation, type EducationEntry } from "@/src/services/user";
import { type Creator, type CreatorLevel } from "@/app/(site)/creators/_hooks/use-creator";
import { useCreatorCertificates } from "@/app/(site)/creators/_hooks/use-certificates";
import { CreatorExperience } from "./creator-experience";
import { LevelApplyDialog } from "@/app/(site)/creators/_components/center/dialogs/level-apply-dialog";
import { userLevelDisplayCopy } from "@/src/lib/user-level-catalog";
import { IpPublisherLogos } from "@/components/ip-commerce/ip-publisher-logos";
import type { IpPublisherPublic } from "@/src/lib/ip-commerce/api";
import { useAllMyIpCommerceIps, usePublicCreatorIps } from "@/src/lib/ip-commerce/hooks";

interface CreatorLeftRailProps {
  creator: Creator;
  isOwner: boolean;
  /**
   * Owner clicked any per-section edit pencil — parent opens the
   * ProfileEditDialog. Every card that carries the pencil (profile
   * info / bio / education) shares the one callback
   * because the dialog covers the whole profile, not per-field. The
   * info card qualifies through its verification row: that reads off
   * `contact`, which is one of the fields the dialog edits.
   */
  onEditProfile?: () => void;
  /**
   * Owner clicked "account & security" — parent opens the password
   * panel. Owner-only, and absent entirely on a visitor's view of
   * someone else's profile.
   */
  onOpenSecurity?: () => void;
}

export function CreatorLeftRail({
  creator,
  isOwner,
  onEditProfile,
  onOpenSecurity,
}: CreatorLeftRailProps) {
  const t = useTranslations("creatorCenter");
  const securityT = useTranslations("accountSecurity");
  const locale = useLocale() as Locale;
  const { data: certificates = [] } = useCreatorCertificates(creator.id);
  const [levelApplyOpen, setLevelApplyOpen] = useState(false);
  const joined = formatJoined(creator.joinedAt);
  const topCertificate = certificates[0] ?? null;

  // Aggregated distributors from this creator's public (or own) IPs — shown
  // only in 档案信息, not on the IPs tab cards.
  const myIps = useAllMyIpCommerceIps(isOwner, { locale });
  const publicIps = usePublicCreatorIps(creator.id, !isOwner, { locale });
  const publishers = useMemo(() => {
    const items = isOwner ? (myIps.data?.items ?? []) : (publicIps.data?.items ?? []);
    const byId = new Map<string, IpPublisherPublic>();
    for (const ip of items) {
      for (const publisher of ip.publishers ?? []) {
        if (!publisher.logoUrl?.trim()) continue;
        if (!byId.has(publisher.id)) byId.set(publisher.id, publisher);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.displayOrder - b.displayOrder);
  }, [isOwner, myIps.data?.items, publicIps.data?.items]);

  const bio = (creator.bio || "").trim();
  const education = parseEducation(creator.study);
  const levels = Array.isArray(creator.levels) ? creator.levels.filter((l) => !!l?.name) : [];

  const editAction = isOwner ? (
    <Button
      type="button"
      variant="ghost"
      color="muted"
      size="sm"
      onClick={() => onEditProfile?.()}
      aria-label={t("cta.editProfile")}
    >
      <IconEdit className="size-3.5" />
    </Button>
  ) : null;

  const levelApplyAction = isOwner ? (
    <Button
      type="button"
      variant="soft"
      color="primary"
      size="sm"
      onClick={() => setLevelApplyOpen(true)}
      aria-label={t("levels.apply.cta")}
      className="h-6 gap-1 rounded-full px-2.5 text-[11px] font-medium"
    >
      <IconPlus className="size-3" stroke={2.25} />
      {t("levels.apply.cta")}
    </Button>
  ) : null;

  return (
    <aside className="space-y-4 lg:self-start">
      <RailCard title={t("info.heading")} action={editAction}>
        <div className="space-y-2.5 text-xs">
          <InfoRow
            label={t("info.userId")}
            value={creator.id != null ? encodeUserId(creator.id) : "—"}
          />
          <InfoRow
            label={t("info.kyc")}
            value={creator.contact ? t("info.kycVerified") : t("info.kycPending")}
          />
          {joined ? <InfoRow label={t("info.joined")} value={joined} /> : null}
        </div>
      </RailCard>

      {publishers.length > 0 ? (
        <RailCard title={t("info.publishers")}>
          <IpPublisherLogos publishers={publishers} size="lg" />
        </RailCard>
      ) : null}

      {/* FD Certification badges — GitHub-achievements pattern: grid
          of imagePath icons, name underneath, full description on
          hover. Empty state encourages owners to earn one and reads
          as "not yet" rather than "broken" for visitors. */}
      <RailCard
        title={t("levels.heading")}
        action={
          <div className="flex items-center gap-1">
            <CertificationGuide />
            {levelApplyAction}
          </div>
        }
      >
        {levels.length === 0 ? (
          <div className="space-y-2.5">
            <EmptyHint body={isOwner ? t("levels.emptyOwner") : t("levels.emptyVisitor")} />
            {isOwner ? (
              <Button
                type="button"
                variant="soft"
                color="primary"
                size="sm"
                className="h-7 w-full rounded-lg text-[11px] font-medium"
                onClick={() => setLevelApplyOpen(true)}
              >
                <IconPlus className="size-3.5" />
                {t("levels.apply.emptyCta")}
              </Button>
            ) : null}
          </div>
        ) : (
          <TooltipProvider delayDuration={150}>
            <ul className="grid grid-cols-3 gap-4">
              {levels.map((l) => (
                <LevelBadge key={l.id} level={l} />
              ))}
            </ul>
          </TooltipProvider>
        )}
      </RailCard>

      {isOwner ? <LevelApplyDialog open={levelApplyOpen} onOpenChange={setLevelApplyOpen} /> : null}

      <RailCard title={t("about.bioHeading")} action={editAction}>
        {bio ? (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{bio}</p>
        ) : (
          <EmptyHint body={isOwner ? t("about.bioEmptyOwner") : t("about.bioEmptyVisitor")} />
        )}
      </RailCard>

      <RailCard title={t("about.educationHeading")} action={editAction}>
        {education.length === 0 ? (
          <EmptyHint
            body={isOwner ? t("about.educationEmptyOwner") : t("about.educationEmptyVisitor")}
          />
        ) : (
          <ul className="space-y-2.5">
            {education.map((e, i) => (
              <EducationRow key={i} entry={e} />
            ))}
          </ul>
        )}
      </RailCard>

      <CreatorExperience creatorId={creator.id} isOwner={isOwner} />

      {topCertificate ? (
        <RailCard title={t("certificates.railHeading")}>
          <div className="flex items-start gap-3 text-xs">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <IconCertificate className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                <IconShieldCheck className="size-3.5" />
                {t("certificates.verified")}
              </div>
              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                {topCertificate.title}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("certificates.railCount", { count: certificates.length })}
              </p>
            </div>
          </div>
        </RailCard>
      ) : null}

      {/* Account & security. Owner-only and last in the rail: it is
          settings, not identity, so it must not compete with the
          profile content a visitor came to read. */}
      {isOwner && onOpenSecurity ? (
        <RailCard title={securityT("railHeading")}>
          <div className="flex items-start gap-3 text-xs">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
              <IconLock className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-foreground">{securityT("railBody")}</p>
              <Button
                type="button"
                variant="ghost"
                color="muted"
                size="sm"
                className="mt-2 px-0"
                onClick={onOpenSecurity}
              >
                {securityT("railAction")}
              </Button>
            </div>
          </div>
        </RailCard>
      ) : null}
    </aside>
  );
}

function RailCard({
  title,
  titleExtra,
  action,
  children,
}: {
  title: string;
  titleExtra?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-card px-5 py-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</h2>
          {titleExtra}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyHint({ body }: { body: string }) {
  return <p className="text-xs text-muted-foreground">{body}</p>;
}

export function LevelBadge({ level }: { level: CreatorLevel }) {
  // Image-first: render the resolved imagePath when present, fall back
  // to a generic check chip when the badge graphic is missing or 404s
  // so the cell never collapses to a broken-image glyph.
  const t = useTranslations("creatorCenter");
  const copy = userLevelDisplayCopy(level, t);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageOk = Boolean(level.iconUrl) && failedUrl !== level.iconUrl;
  const tooltipBody = copy.description || copy.name;

  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={copy.name}
            className="flex w-full flex-col items-center gap-2 rounded-xl p-2 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn(
                "flex size-16 items-center justify-center",
                imageOk && level.iconUrl
                  ? "overflow-visible bg-transparent"
                  : "overflow-hidden rounded-full bg-primary/10 text-primary"
              )}
            >
              {imageOk && level.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={level.iconUrl}
                  alt={copy.name}
                  className="size-full object-contain"
                  loading="lazy"
                  onError={() => setFailedUrl(level.iconUrl)}
                />
              ) : (
                <IconCircleCheck className="size-8" />
              )}
            </span>
            <span className="line-clamp-1 text-[11px] font-medium text-muted-foreground">
              {copy.name}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px] text-xs">
          <div className="font-semibold">{copy.name}</div>
          {copy.description && copy.description !== copy.name ? (
            <div className="mt-0.5 text-muted-foreground">{tooltipBody}</div>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </li>
  );
}

function EducationRow({ entry }: { entry: EducationEntry }) {
  const range = formatRange(entry.startDate, entry.endDate);
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <IconSchool className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">{entry.schoolName || "—"}</span>
          {entry.major ? (
            <span className="text-xs text-muted-foreground">{entry.major}</span>
          ) : null}
        </div>
        {range ? <div className="mt-0.5 text-[11px] text-muted-foreground">{range}</div> : null}
      </div>
    </li>
  );
}

function formatJoined(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function formatRange(start?: string, end?: string): string {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s && !e) return "";
  if (s && !e) return `${s} — present`;
  if (!s && e) return e;
  return `${s} — ${e}`;
}
