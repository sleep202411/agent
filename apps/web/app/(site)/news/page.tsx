import { headers } from "next/headers";
import { getNewsList, getNewsTags } from "./_data/news";
import { localizedCategories } from "./_data/categories";
import { NewsList } from "./_components/news-list";
import { JsonLd, buildBreadcrumbList, buildItemList, localeCanonicalUrl } from "@/src/lib/seo";

export default async function NewsPage() {
  // proxy.ts sets x-locale on the rewritten request based on the URL prefix.
  const lang = (await headers()).get("x-locale") ?? "en-US";
  // Fetch the feed and the backend tag list together — the tag bar filters the
  // feed client-side, so both are needed before first paint.
  const [all, tags] = await Promise.all([getNewsList(lang), getNewsTags(lang)]);
  // Categorized (country) articles live ONLY on their category page — keep the
  // main feed to uncategorized / live news so "All" isn't a duplicate of a category.
  const articles = all.filter((a) => !a.category);

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
      <NewsList articles={articles} categories={localizedCategories(lang)} tags={tags} />
    </>
  );
}
