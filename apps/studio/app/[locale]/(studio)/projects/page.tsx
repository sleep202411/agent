import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { ProjectsEmptyState } from "./_components/empty-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("projects.metaTitle") };
}

export default async function ProjectsPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="w-full px-6 py-8">
      <SectionHeading as="h1" title={t("projects.title")} subtitle={t("projects.subtitle")} />
      <ProjectsEmptyState />
    </main>
  );
}
