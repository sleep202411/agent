import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getNewsList } from "../_data/news";
import { NewsDetail, NewsNotFound } from "../_components/news-detail";
import { JsonLd, buildArticle, buildBreadcrumbList, localeCanonicalUrl } from "@/src/lib/seo";

export default async function NewsDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const numId = Number(id);
  const lang = (await headers()).get("x-locale") ?? "en-US";
  const all = await getNewsList(lang);
  const item = all.find((a) => a.id === numId);

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
