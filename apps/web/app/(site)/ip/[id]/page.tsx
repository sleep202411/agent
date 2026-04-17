"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconBook,
  IconTarget,
  IconCalendar,
  IconUsers,
  IconBolt,
  IconMessageCircle,
  IconChevronDown,
  IconStar,
  IconCircleCheck,
  IconTrendingUp,
  IconMovie,
  IconShoppingCart,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { IconLoader2 } from "@tabler/icons-react";
import {
  STAGE_CONFIG,
  PLAN_STATUS_CLASS,
  MOCK_IP_DETAIL,
  type IPDetail,
} from "@/app/(site)/ip/_components/ip-mock";
import { FundingSidebar } from "@/app/(site)/ip/_components/ip-detail-panels";
import { env } from "@/src/env";
import {
  useProjectDetail,
  useProjectVideoLink,
  useProjectMembers,
  useProjectJobs,
} from "@/src/hooks/use-my-projects";

// ─── Section config ──────────────────────────────────

const SECTIONS = [
  { key: "story", labelKey: "sectionStory" },
  { key: "whyThisIP", labelKey: "sectionWhyThisIP" },
  { key: "productionPlan", labelKey: "sectionProductionPlan" },
  { key: "creativeTeam", labelKey: "sectionCreativeTeam" },
  { key: "updates", labelKey: "sectionUpdates" },
  { key: "faq", labelKey: "sectionFAQ" },
] as const;

const STAGE_ICON = {
  investment: IconTrendingUp,
  presale: IconShoppingCart,
  producing: IconMovie,
  released: IconCircleCheck,
};

// ─── Component ───────────────────────────────────────

export default function IPDetailPage({ id }: { id: string }) {
  const t = useTranslations("ip");
  const [activeSection, setActiveSection] = useState<string>("story");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Real API data
  const { data: project, isLoading } = useProjectDetail(id);
  const { data: videoLink } = useProjectVideoLink(id);
  const { data: members } = useProjectMembers(id);
  const { data: jobs } = useProjectJobs(id);

  // Bridge API data to existing IPDetail mock structure (gradual migration)
  const ip: IPDetail = project
    ? ({
        ...MOCK_IP_DETAIL,
        title: project.name ?? "",
        desc: project.description ?? "",
        cover: project.bannerLink
          ? project.bannerLink.startsWith("http")
            ? project.bannerLink
            : `${env.BANNER_BASE_URL}/${project.bannerLink}`
          : MOCK_IP_DETAIL.cover,
        story: project.story ?? project.background ?? "",
        whyThisIP: project.whyThisIP ?? "",
        tags: (() => {
          try {
            const t = JSON.parse(project.tag ?? "[]");
            return Array.isArray(t) ? t.map(String) : [];
          } catch {
            return [];
          }
        })(),
        targetEpisodes: project.targetEpisodes ?? 0,
        team: (Array.isArray(members) ? members : []).map((m) => ({
          name: m.nickName || m.userName || "Member",
          role: m.roleName || "Team",
          avatar: m.avatar ? `${env.USER_BASE_URL || env.OSS_BASE_URL}/${m.avatar}` : "",
          level: "",
          projects: 0,
          rating: 0,
        })),
      } as IPDetail)
    : MOCK_IP_DETAIL;

  const stage = STAGE_CONFIG[ip.stage];
  const StageIcon = STAGE_ICON[ip.stage];

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const scrollToSection = (key: string) => {
    setActiveSection(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Back + manage */}
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 pt-4">
        <Link
          href="/ips"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          {t("detailBackToPlaza")}
        </Link>
        <a
          href={`/ips/${id}/edit`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70"
        >
          {t("detailManage")}
        </a>
      </div>

      {/* Hero */}
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-4xl font-bold text-foreground">{ip.title}</h1>
          <p className="mb-3 text-sm text-muted-foreground">{ip.tagline}</p>
          <div className="mb-3 flex items-center justify-center gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                stage.badge
              )}
            >
              <StageIcon className="size-3.5" />
              {t(stage.labelKey)}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {ip.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="mx-auto max-w-screen-2xl px-6 pb-12">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Left */}
          <div className="space-y-8 lg:col-span-2">
            {/* Cover */}
            <div className="aspect-video w-full overflow-hidden rounded-xl bg-secondary">
              <img
                src={ip.cover.replace("w=600", "w=1200")}
                alt={ip.title}
                className="size-full object-cover"
              />
            </div>

            {/* Section nav */}
            <div className="sticky top-14 z-40 -mx-6 border-b border-border bg-background px-6">
              <div className="flex items-center gap-0">
                {SECTIONS.map((section) => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => scrollToSection(section.key)}
                    className={cn(
                      "border-b-2 px-5 py-3 text-sm font-medium transition-colors",
                      activeSection === section.key
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t(section.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Story */}
            <div
              ref={(el) => {
                sectionRefs.current.story = el;
              }}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconBook className="size-5 text-primary" />
                {t("sectionStory")}
              </h2>
              {ip.story.split("\n\n").map((p, i) => (
                <p key={i} className="mb-3 text-sm leading-relaxed text-secondary-foreground">
                  {p}
                </p>
              ))}
            </div>

            {/* Why This IP */}
            <div
              ref={(el) => {
                sectionRefs.current.whyThisIP = el;
              }}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconTarget className="size-5 text-orange-400" />
                {t("sectionWhyThisIP")}
              </h2>
              {ip.whyThisIP.split("\n\n").map((p, i) => (
                <p key={i} className="mb-3 text-sm leading-relaxed text-secondary-foreground">
                  {p}
                </p>
              ))}
            </div>

            {/* Production Plan */}
            <div
              ref={(el) => {
                sectionRefs.current.productionPlan = el;
              }}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconCalendar className="size-5 text-blue-400" />
                {t("sectionProductionPlan")}
              </h2>
              <div className="space-y-3">
                {ip.productionPlan.map((phase, i) => (
                  <div
                    key={i}
                    className={cn("rounded-xl border p-4", PLAN_STATUS_CLASS[phase.status])}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-foreground">{phase.phase}</h4>
                      <span className="rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] font-medium">
                        {t(`planStatus_${phase.status}`)}
                      </span>
                    </div>
                    <p className="mb-1 text-xs text-muted-foreground">{phase.timeline}</p>
                    <p className="text-xs text-muted-foreground/70">{phase.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Creative Team */}
            <div
              ref={(el) => {
                sectionRefs.current.creativeTeam = el;
              }}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconUsers className="size-5 text-violet-400" />
                {t("sectionCreativeTeam")}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {ip.team.map((member) => (
                  <div
                    key={member.name}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-lg">
                      {member.avatar}
                    </div>
                    <div>
                      <div className="mb-0.5 flex items-center gap-1.5">
                        <span className="text-sm font-medium text-foreground">{member.name}</span>
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                          {member.level}
                        </span>
                        {member.certified && <IconCircleCheck className="size-3 text-green-400" />}
                      </div>
                      <div className="mb-1 text-xs text-primary">{member.role}</div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>
                          {member.projects} {t("detailProjects")}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <IconStar className="size-2.5 fill-accent text-accent" />
                          {member.rating}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Updates */}
            <div
              ref={(el) => {
                sectionRefs.current.updates = el;
              }}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconBolt className="size-5 text-amber-400" />
                {t("sectionUpdates")}
              </h2>
              <div className="space-y-4">
                {ip.updates.map((update, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{update.date}</span>
                    </div>
                    <h4 className="mb-1 text-sm font-medium text-foreground">{update.title}</h4>
                    <p className="text-xs leading-relaxed text-secondary-foreground">
                      {update.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* FAQ */}
            <div
              ref={(el) => {
                sectionRefs.current.faq = el;
              }}
            >
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
                <IconMessageCircle className="size-5 text-cyan-400" />
                {t("sectionFAQ")}
              </h2>
              <div className="space-y-2">
                {ip.faqs.map((faq, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
                    <button
                      type="button"
                      onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                      className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-secondary"
                    >
                      <span className="text-sm font-medium text-foreground">{faq.q}</span>
                      <IconChevronDown
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          expandedFaq === i && "rotate-180"
                        )}
                      />
                    </button>
                    {expandedFaq === i && (
                      <div className="px-4 pb-4">
                        <p className="text-xs leading-relaxed text-secondary-foreground">{faq.a}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div>
            <FundingSidebar ip={ip} />
          </div>
        </div>
      </div>
    </div>
  );
}
