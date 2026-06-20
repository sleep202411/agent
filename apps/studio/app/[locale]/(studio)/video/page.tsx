import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { VideoStudio } from "./_components/video-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("video.metaTitle") };
}

export default async function VideoPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-6">
      <SectionHeading as="h1" title={t("video.title")} subtitle={t("video.subtitle")} />

      <WorkspaceRemount>
        <VideoStudio />
      </WorkspaceRemount>
    </main>
  );
}
