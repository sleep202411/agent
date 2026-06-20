import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { AudioStudio } from "./_components/audio-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("audio.metaTitle") };
}

export default async function AudioPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="w-full px-6 py-8 pb-56">
      <SectionHeading as="h1" title={t("audio.title")} subtitle={t("audio.subtitle")} />

      <WorkspaceRemount>
        <AudioStudio />
      </WorkspaceRemount>
    </main>
  );
}
