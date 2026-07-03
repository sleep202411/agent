import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/ui/section-heading";
import { WorkspaceRemount } from "@/app/_components/workspace-remount";
import { CharactersGrid } from "./_components/characters-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("characters");
  return { title: t("metaTitle") };
}

export default async function CharactersPage() {
  const t = await getTranslations("characters");
  return (
    <main className="w-full px-6 py-8">
      <SectionHeading as="h1" title={t("title")} subtitle={t("subtitle")} />

      <WorkspaceRemount>
        <CharactersGrid />
      </WorkspaceRemount>
    </main>
  );
}
