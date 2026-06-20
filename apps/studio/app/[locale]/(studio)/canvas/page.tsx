import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { CanvasProjectsGrid } from "./_components/projects-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("canvas.metaTitle") };
}

export default async function CanvasProjectsPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="w-full px-6 py-8">
      <SectionHeading as="h1" title={t("canvas.title")} subtitle={t("canvas.subtitle")} />
      <CanvasProjectsGrid />
    </main>
  );
}
