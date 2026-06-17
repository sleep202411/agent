import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { ImageStudio } from "./_components/image-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("image.metaTitle") };
}

export default async function ImagesPage() {
  const t = await getTranslations("studioModes");
  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">{t("image.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("image.subtitle")}</p>

      <WorkspaceRemount>
        <ImageStudio />
      </WorkspaceRemount>
    </main>
  );
}
