"use client";

/**
 * AboutTab — biography, education, work experience, contact.
 *
 * Data sources are all read-only here:
 *   - creator.bio          → 简介
 *   - creator.study        → 教育经历 (JSON via parseEducation)
 *   - useCreatorExperience → 工作经历 (GET /user/resumer/list/{id})
 *   - creator.contact      → 联系方式 (only shown if non-empty)
 *
 * Owner sees a "编辑资料" affordance per section that today just
 * toasts the Phase-1b hint — the edit flows live in the profile
 * settings route and get linked when we wire deep links in.
 */
import { IconBriefcase, IconEdit, IconMail, IconSchool } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { parseEducation, type EducationEntry } from "@/src/services/user";
import { useCreatorExperience, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { ExperienceEntry } from "@/app/(site)/profile/_hooks/use-profile-extras";

interface AboutTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function AboutTab({ creator, isOwner }: AboutTabProps) {
  const t = useTranslations("creatorCenter");
  const { data: experience } = useCreatorExperience(creator.id);

  const bio = (creator.bio || "").trim();
  const education = parseEducation(creator.study);
  const experiences = (experience ?? []).filter((e): e is ExperienceEntry => !!e);
  const contact = (creator.contact || "").trim();

  return (
    <div className="space-y-5">
      <Section
        title={t("about.bioHeading")}
        action={isOwner ? <EditButton onClick={() => toast.info(t("ctaEditComingSoon"))} /> : null}
      >
        {bio ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{bio}</p>
        ) : (
          <EmptyHint body={isOwner ? t("about.bioEmptyOwner") : t("about.bioEmptyVisitor")} />
        )}
      </Section>

      <Section
        title={t("about.educationHeading")}
        action={isOwner ? <EditButton onClick={() => toast.info(t("ctaEditComingSoon"))} /> : null}
      >
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
      </Section>

      <Section
        title={t("about.experienceHeading")}
        action={isOwner ? <EditButton onClick={() => toast.info(t("ctaEditComingSoon"))} /> : null}
      >
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
      </Section>

      {contact ? (
        <Section title={t("about.contactHeading")}>
          <div className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">
            <IconMail className="size-4 text-muted-foreground" />
            <span className="font-mono">{contact}</span>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" color="muted" size="sm" onClick={onClick}>
      <IconEdit className="size-3.5" />
    </Button>
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

function formatRange(start?: string, end?: string): string {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s && !e) return "";
  if (s && !e) return `${s} — present`;
  if (!s && e) return e;
  return `${s} — ${e}`;
}
