import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CanvasProjectsGrid } from "./_components/projects-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("canvas.metaTitle") };
}

export default async function CanvasProjectsPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">{t("canvas.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("canvas.subtitle")}</p>
      <CanvasProjectsGrid />
    </main>
  );
}
