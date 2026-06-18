import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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
      <h1 className="text-xl font-semibold">{t("video.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("video.subtitle")}</p>

      <WorkspaceRemount>
        <VideoStudio />
      </WorkspaceRemount>
    </main>
  );
}
