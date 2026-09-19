import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { ContentReviewStudio } from "./_components/content-review-studio";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studioModes");
  return { title: t("contentReview.metaTitle") };
}

export default async function ContentReviewPage() {
  const t = await getTranslations("studioModes.contentReview");
  return (
    <main className="w-full px-6 py-8">
      <SectionHeading as="h1" title={t("title")} subtitle={t("subtitle")} />
      <ul className="mt-4 max-w-2xl list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t("capVisual")}</li>
        <li>{t("capAudio")}</li>
        <li>{t("capReport")}</li>
        <li>{t("capCredits")}</li>
      </ul>
      <WorkspaceRemount>
        <ContentReviewStudio />
      </WorkspaceRemount>
    </main>
  );
}
