import { headers } from "next/headers";
import { getNewsList } from "./_data/news";
import { NewsList } from "./_components/news-list";

export default async function NewsPage() {
  // proxy.ts sets x-locale on the rewritten request based on the URL prefix.
  const lang = (await headers()).get("x-locale") ?? "en-US";
  const articles = await getNewsList(lang);
  return <NewsList articles={articles} />;
}
