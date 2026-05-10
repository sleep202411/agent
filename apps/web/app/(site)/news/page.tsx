import { headers } from "next/headers";
import { getNewsList } from "./_data/news";
import { NewsList } from "./_components/news-list";
import { JsonLd, buildBreadcrumbList, buildItemList, localeCanonicalUrl } from "@/src/lib/seo";

export default async function NewsPage() {
  // proxy.ts sets x-locale on the rewritten request based on the URL prefix.
  const lang = (await headers()).get("x-locale") ?? "en-US";
  const articles = await getNewsList(lang);

  // Cap at 50 — schema-data weight matters and ranking gain plateaus
  // beyond the first page slice. Internal articles take priority over
  // external links since they're our own canonical content.
  const ranked = [
    ...articles.filter((a) => !a.isExternal),
    ...articles.filter((a) => a.isExternal),
  ].slice(0, 50);

  const itemList = buildItemList(
    localeCanonicalUrl("/news", lang),
    ranked.map((a) => ({
      url: a.isExternal && a.url ? a.url : localeCanonicalUrl(`/news/${a.id}`, lang),
      name: a.title,
      image: a.cover || undefined,
    }))
  );
  const breadcrumb = buildBreadcrumbList([
    { name: "FizzDragon", url: localeCanonicalUrl("/", lang) },
    { name: "News", url: localeCanonicalUrl("/news", lang) },
  ]);

  return (
    <>
      <JsonLd data={[itemList, breadcrumb]} />
      <NewsList articles={articles} />
    </>
  );
}
