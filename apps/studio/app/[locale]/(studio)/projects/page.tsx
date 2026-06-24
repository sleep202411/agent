import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { CanvasProjectsGrid } from "../canvas/_components/projects-grid";
import { ProjectsList } from "./_components/projects-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("projects.metaTitle") };
}

export default async function ProjectsPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="w-full space-y-12 px-6 py-8">
      <section>
        <SectionHeading
          as="h1"
          title={t("projects.canvasTitle")}
          subtitle={t("projects.canvasSubtitle")}
        />
        <CanvasProjectsGrid />
      </section>

      <ProjectsList />
    </main>
  );
}
