import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { AudioStudio } from "./_components/audio-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("audio.metaTitle") };
}

export default async function AudioPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="mx-auto w-full px-4 py-8 pb-56 sm:px-6">
      <h1 className="text-xl font-semibold">{t("audio.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("audio.subtitle")}</p>

      <WorkspaceRemount>
        <AudioStudio />
      </WorkspaceRemount>
    </main>
  );
}
