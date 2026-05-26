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
 * Edit affordances: each ownable section carries a pencil that opens
 * the same ProfileEditDialog the hero "Edit profile" CTA used to. The
 * dialog is a multi-field surface so any pencil opens the whole sheet
 * — close-by-context, single source of truth.
 *
 * No `sticky` modifier here: the rail can run longer than the viewport
 * once a creator fills in their resume, and a half-clipped sticky rail
 * reads worse than one that scrolls with the content. The right pane
 * is typically equally tall, so empty space below the rail isn't a
 * concern in practice.
 */
import {
  IconBriefcase,
  IconCertificate,
  IconEdit,
  IconSchool,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { parseEducation, type EducationEntry } from "@/src/services/user";
import { useCreatorExperience, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { ExperienceEntry } from "@/app/(site)/profile/_hooks/use-profile-extras";
import { getCreatorCertificates } from "@/app/(site)/creators/_data/certificates";

interface CreatorLeftRailProps {
  creator: Creator;
  isOwner: boolean;
  /**
   * Owner clicked any per-section edit pencil — parent opens the
   * ProfileEditDialog. All editable sections (bio / education /
   * experience) share the one callback because the dialog covers
   * the whole profile, not per-field.
   */
  onEditProfile?: () => void;
}

export function CreatorLeftRail({ creator, isOwner, onEditProfile }: CreatorLeftRailProps) {
  const t = useTranslations("creatorCenter");
  const { data: experience } = useCreatorExperience(creator.id);
  const joined = formatJoined(creator.joinedAt);
  const certificates = getCreatorCertificates(creator.id);
  const topCertificate = certificates[0] ?? null;

  const bio = (creator.bio || "").trim();
  const education = parseEducation(creator.study);
  const experiences = (experience ?? []).filter((e): e is ExperienceEntry => !!e);

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

  return (
    <aside className="space-y-4 lg:self-start">
      <RailCard title={t("info.heading")}>
        <div className="space-y-2.5 text-xs">
          <InfoRow label={t("info.userId")} value={String(creator.id ?? "—")} />
          <InfoRow
            label={t("info.kyc")}
            value={creator.contact ? t("info.kycVerified") : t("info.kycPending")}
          />
          {joined ? <InfoRow label={t("info.joined")} value={joined} /> : null}
          {creator.contact ? <InfoRow label={t("info.contact")} value={creator.contact} /> : null}
        </div>
      </RailCard>

      <RailCard title={t("about.bioHeading")} action={editAction}>
        {bio ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{bio}</p>
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

      <RailCard title={t("about.experienceHeading")} action={editAction}>
        {experiences.length === 0 ? (
          <EmptyHint
            body={isOwner ? t("about.experienceEmptyOwner") : t("about.experienceEmptyVisitor")}
          />
        ) : (
          <ul className="space-y-3.5">
            {experiences.map((e, i) => (
              <ExperienceRow key={String(e.id ?? i)} entry={e} />
            ))}
          </ul>
        )}
      </RailCard>

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
    </aside>
  );
}

function RailCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-card px-5 py-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
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

function ExperienceRow({ entry }: { entry: ExperienceEntry }) {
  const range = formatRange(entry.startTime, entry.endTime);
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <IconBriefcase className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-foreground">{entry.title || "—"}</span>
          {entry.organization ? (
            <span className="text-xs text-muted-foreground">· {entry.organization}</span>
          ) : null}
        </div>
        {(range || entry.location) && (
          <div className="text-[11px] text-muted-foreground">
            {[range, entry.location].filter(Boolean).join(" · ")}
          </div>
        )}
        {entry.description ? (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {entry.description}
          </p>
        ) : null}
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
