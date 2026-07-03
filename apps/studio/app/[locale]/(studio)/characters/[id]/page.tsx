import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CharacterDetailView } from "../_components/character-detail-view";
import { EnrollmentCallbackFrame } from "../_components/enrollment-callback-frame";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("characters");
  return { title: t("detailMetaTitle") };
}

export default async function CharacterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams?: Promise<{ enrollment?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  // The BytePlus H5 flow redirects the enrollment iframe here on completion.
  // Inside that iframe we must NOT mount the full detail view (nested app +
  // recursive H5 iframe) — the callback frame pokes the parent tab instead.
  const isEnrollmentCallback = sp.enrollment === "callback";

  return (
    <main className="w-full px-6 py-8">
      {isEnrollmentCallback ? (
        <EnrollmentCallbackFrame characterId={id} />
      ) : (
        <CharacterDetailView characterId={id} />
      )}
    </main>
  );
}
