import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getNewsList } from "../../_data/news";
import { categoryLabel, getNewsCategory, localizedCategories } from "../../_data/categories";
import { NewsList } from "../../_components/news-list";
import { JsonLd, buildBreadcrumbList, buildItemList, localeCanonicalUrl } from "@/src/lib/seo";

export default async function NewsCategoryPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const category = getNewsCategory(slug);
  if (!category) notFound();

  // proxy.ts sets x-locale on the rewritten request based on the URL prefix.
  const lang = (await headers()).get("x-locale") ?? "en-US";
  const all = await getNewsList(lang);
  // Category pages show only the curated (static) articles tagged with this
  // category; live external news is uncategorized and stays on the main feed.
  const articles = all.filter((a) => a.category === slug);
  const label = categoryLabel(category, lang);

  const path = `/news/category/${slug}`;
  const itemList = buildItemList(
    localeCanonicalUrl(path, lang),
    articles.slice(0, 50).map((a) => ({
      url: localeCanonicalUrl(`/news/${a.id}`, lang),
      name: a.title,
      image: a.cover || undefined,
    }))
  );
  const breadcrumb = buildBreadcrumbList([
    { name: "FizzDragon", url: localeCanonicalUrl("/", lang) },
    { name: "News", url: localeCanonicalUrl("/news", lang) },
    { name: label, url: localeCanonicalUrl(path, lang) },
  ]);

  return (
    <>
      <JsonLd data={[itemList, breadcrumb]} />
      <NewsList articles={articles} categories={localizedCategories(lang)} activeCategory={slug} />
    </>
  );
}
