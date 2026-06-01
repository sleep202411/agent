import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { defaultLocale, isValidLocale } from "@/src/i18n/config";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LegacyIpEditRedirectPage({ params }: PageProps) {
  const { id } = await params;
  const localeHeader = (await headers()).get("x-locale") ?? defaultLocale;
  const locale = isValidLocale(localeHeader) ? localeHeader : defaultLocale;
  redirect(`/${locale}/ip-studio/${id}`);
}
