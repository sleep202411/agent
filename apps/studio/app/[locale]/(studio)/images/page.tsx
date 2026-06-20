import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { ImageStudio } from "./_components/image-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("image.metaTitle") };
}

export default async function ImagesPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="w-full px-6 py-8">
      <SectionHeading as="h1" title={t("image.title")} subtitle={t("image.subtitle")} />

      <WorkspaceRemount>
        <ImageStudio />
      </WorkspaceRemount>
    </main>
  );
}
