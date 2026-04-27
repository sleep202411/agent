import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getNewsList } from "../_data/news";
import { NewsDetail, NewsNotFound } from "../_components/news-detail";

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

  return <NewsDetail item={item} all={all} />;
}
