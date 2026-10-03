import { headers } from "next/headers";
import { getNewsPage, getNewsTags } from "./_data/news";
import { NewsLoadError } from "./_components/news-load-error";
import { NewsList } from "./_components/news-list";
import { JsonLd, buildBreadcrumbList, buildItemList, localeCanonicalUrl } from "@/src/lib/seo";

export default async function NewsPage() {
  // proxy.ts sets x-locale on the rewritten request based on the URL prefix.
  const lang = (await headers()).get("x-locale") ?? "en-US";
  // Fetch the first page (All) + the backend tag list. The tag bar refetches by
  // tag on switch; this is the initial "All" render.
  const [feed, filters] = await Promise.allSettled([getNewsPage(lang), getNewsTags(lang)]);
  if (feed.status === "rejected")
    return <NewsLoadError error={String(feed.reason?.message || feed.reason)} />;
  const articles = feed.value.items;
  const tags = filters.status === "fulfilled" ? filters.value : [];

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
      {filters.status === "rejected" && (
        <NewsLoadError error={String(filters.reason?.message || filters.reason)} />
      )}
      <NewsList key={lang} articles={articles} tags={tags} initialHasMore={feed.value.hasMore} />
    </>
  );
}
