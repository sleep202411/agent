import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { StoryProjectLibrary } from "../../(studio)/story-studio/_components/story-project-library";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("storyStudio");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default function StoryStudioPage() {
  return (
    <div className="relative min-h-screen bg-[#101112] text-white antialiased">
      <main className="relative min-h-screen overflow-x-clip pb-16 pt-14">
        <StoryProjectLibrary />
      </main>
    </div>
  );
}
