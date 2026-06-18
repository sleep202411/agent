import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProjectsEmptyState } from "./_components/empty-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("projects.metaTitle") };
}

export default async function ProjectsPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">{t("projects.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("projects.subtitle")}</p>

      <ProjectsEmptyState />
    </main>
  );
}
