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
    <main className="w-full px-6 py-5">
      <SectionHeading as="h1" title={t("title")} subtitle={t("subtitle")} />
      <details className="mt-2 max-w-3xl text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none text-white/55 hover:text-white/80">
          {t("aboutToggle")}
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t("capVisual")}</li>
          <li>{t("capAudio")}</li>
          <li>{t("capReport")}</li>
          <li>{t("capCredits")}</li>
          <li>{t("capTimeline")}</li>
          <li>{t("capShare")}</li>
        </ul>
      </details>
      <WorkspaceRemount>
        <ContentReviewStudio />
      </WorkspaceRemount>
    </main>
  );
}
