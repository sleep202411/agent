"use client";

import { useTranslations } from "next-intl";
import { ProductUpdateDialog } from "@/components/product-updates/product-update-dialog";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import type { ProjectSkillCatalogResponse } from "@/lib/project-skills-api";

const FEATURED_SKILL_SLUG = "cinematic-shot-orchestrator";

export function SkillsLaunchAnnouncement({
  catalog,
}: {
  catalog: ProjectSkillCatalogResponse | undefined;
}) {
  const t = useTranslations("project.skills.launchAnnouncement");
  const openSkills = useProjectUIStore((state) => state.openSkills);
  const featuredSkill = catalog?.items.find((skill) => skill.slug === FEATURED_SKILL_SLUG);

  if (!featuredSkill?.previewVideoUrl) return null;

  return (
    <ProductUpdateDialog
      announcementId="project-skills-2026-08"
      title={t("title")}
      description={
        <>
          <strong className="font-semibold text-white/90">{t("leadStrong")}</strong> {t("leadRest")}
        </>
      }
      supportingText={t("supportingText")}
      ctaLabel={t("cta")}
      closeLabel={t("close")}
      muteLabel={t("mute")}
      unmuteLabel={t("unmute")}
      previewQueryParam="previewUpdate"
      media={{
        type: "video",
        src: featuredSkill.previewVideoUrl,
        poster: featuredSkill.previewUrl ?? undefined,
        alt: t("mediaAlt"),
      }}
      onCta={() => openSkills()}
    />
  );
}
