import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { defaultLocale, type Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { IpPublicDetail } from "./_components/ip-public-detail";
import { computeIpUuid } from "../_data/ip-uuid";

export default async function IPDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  // Legacy `/ips/{javaId}` links: a numeric id is a Java IP id. Resolve it to
  // the deterministic PG UUID the migration assigned and 308-redirect to the
  // canonical URL (locale preserved), so old links keep working.
  if (/^\d+$/.test(id)) {
    const locale = ((await headers()).get("x-locale") ?? defaultLocale) as Locale;
    permanentRedirect(localizePath(`/ips/${computeIpUuid(id)}`, locale));
  }
  return <IpPublicDetail ipReference={id} />;
}
