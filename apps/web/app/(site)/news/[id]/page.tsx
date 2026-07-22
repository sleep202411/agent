import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getNewsItem, getNewsList } from "../_data/news";
import { NewsDetail, NewsNotFound } from "../_components/news-detail";
import { JsonLd, buildArticle, buildBreadcrumbList, localeCanonicalUrl } from "@/src/lib/seo";

export default async function NewsDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const numId = Number(id);
  const lang = (await headers()).get("x-locale") ?? "en-US";
  // The detail endpoint carries the full body; the list does not. Fetch both:
  // the single item for its body, the list for the "more news" rail (and as the
  // source of truth for our hardcoded static articles, which have no detail
  // endpoint). Prefer the live detail; fall back to the list card by id.
  const [detail, all] = await Promise.all([getNewsItem(numId, lang), getNewsList(lang)]);
  const item = detail ?? all.find((a) => a.id === numId);

  if (!item) {
    return <NewsNotFound />;
  }

  // External news has no detail body — bounce server-side to the source URL.
  if (item.isExternal && item.url) {
    redirect(item.url);
  }

  const path = `/news/${item.id}`;
  const article = buildArticle({
    url: localeCanonicalUrl(path, lang),
    inLanguage: lang,
    headline: item.title,
    description: item.info,
    image: item.cover,
    datePublished: item.createTime,
    authors: item.author ? [{ name: item.author }] : undefined,
  });
  const breadcrumb = buildBreadcrumbList([
    { name: "FizzDragon", url: localeCanonicalUrl("/", lang) },
    { name: "News", url: localeCanonicalUrl("/news", lang) },
    { name: item.title, url: localeCanonicalUrl(path, lang) },
  ]);

  return (
    <>
      <JsonLd data={[article, breadcrumb]} />
      <NewsDetail item={item} all={all} />
    </>
  );
}
