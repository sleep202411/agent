import { headers } from "next/headers";

import {
  JsonLd,
  buildBreadcrumbList,
  buildCreativeWork,
  buildFaqPage,
  localeCanonicalUrl,
} from "@/src/lib/seo";
import { IPDetailClient } from "./_components/ip-detail-client";
import { fetchProjectDetailServer, fetchProjectFaqsServer } from "./_data/server";

const BANNER_HOST = (
  process.env.NEXT_PUBLIC_BANNER_BASE_URL ??
  "https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com"
).replace(/\/+$/, "");

function resolveBanner(bannerLink: string | null | undefined): string {
  if (!bannerLink) return "";
  if (bannerLink.startsWith("http://") || bannerLink.startsWith("https://")) return bannerLink;
  return `${BANNER_HOST}/${bannerLink.replace(/^\/+/, "")}`;
}

/**
 * IP detail — server entry. Server-fetches project meta + FAQs to emit
 * SSR JSON-LD (CreativeWork + FAQPage + BreadcrumbList) for AI / search
 * crawlers, then hands off to the interactive client component which
 * does the regular client-side data fetching for episodes, video links
 * and live mutations.
 *
 * The schema fetch is best-effort: if the upstream is unreachable or
 * returns a non-public project, we render the client without JSON-LD
 * rather than 500. The client side is unaffected either way.
 */
export default async function IPDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const lang = (await headers()).get("x-locale") ?? "en-US";

  const [project, faqs] = await Promise.all([
    fetchProjectDetailServer(id),
    fetchProjectFaqsServer(id),
  ]);

  const path = `/ips/${id}`;
  const pageUrl = localeCanonicalUrl(path, lang);

  const schema = [
    buildBreadcrumbList([
      { name: "FizzDragon", url: localeCanonicalUrl("/", lang) },
      { name: "IPs", url: localeCanonicalUrl("/ips", lang) },
      { name: project?.name ?? `IP ${id}`, url: pageUrl },
    ]),
    ...(project
      ? [
          buildCreativeWork({
            url: pageUrl,
            inLanguage: lang,
            name: project.name,
            description: project.description ?? project.background ?? project.name,
            image: resolveBanner(project.bannerLink),
            datePublished: project.createTime,
            creator: project.ownerName
              ? {
                  name: project.ownerName,
                  url:
                    project.ownerId != null
                      ? localeCanonicalUrl(`/profile/${project.ownerId}`, lang)
                      : undefined,
                }
              : undefined,
          }),
        ]
      : []),
    ...(faqs.length > 0
      ? [
          buildFaqPage(
            pageUrl,
            faqs.map((f) => ({ question: f.question, answer: f.answer }))
          ),
        ]
      : []),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <IPDetailClient id={id} />
    </>
  );
}
