"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import { imgUrl, timeAgo, flattenItems, useNewsItem, type NewsItem } from "../_hooks/use-news";

export default function NewsDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { item, data, isLoading } = useNewsItem(id);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[800px] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">Article not found</h1>
        <p className="text-sm text-muted-foreground">
          This story may have been removed or the link is invalid.
        </p>
        <Link
          href="/news"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <IconArrowLeft className="size-4" /> Back to News
        </Link>
      </div>
    );
  }

  // "More from FizzDragon" — pick up to 4 other recent items.
  const others: NewsItem[] = [];
  if (data) {
    const all = Array.from(flattenItems(data).values()).filter((it) => it.id !== item.id);
    all.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
    others.push(...all.slice(0, 4));
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[860px] px-5 py-8 md:px-8 md:py-12">
        {/* Back link */}
        <Link
          href="/news"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-4" /> Back to News
        </Link>

        {/* Meta */}
        <div className="mb-4 flex items-center gap-2.5 text-sm">
          <span className="size-2 rounded-full bg-primary" />
          <span className="font-medium text-foreground">FizzDragon</span>
          <span className="text-muted-foreground">· {timeAgo(item.createTime)}</span>
        </div>

        {/* Title */}
        <h1 className="mb-6 text-3xl font-bold leading-tight text-foreground md:text-4xl">
          {item.title}
        </h1>

        {/* Hero image */}
        {item.picLink && (
          <img
            src={imgUrl(item.picLink)}
            alt={item.title}
            className="mb-8 aspect-video w-full rounded-2xl object-cover"
          />
        )}

        {/* Body — only `info` blurb is available; render it as lead paragraph */}
        {item.info && (
          <p className="mb-8 whitespace-pre-line text-base leading-relaxed text-foreground/90 md:text-lg">
            {item.info}
          </p>
        )}

        {/* External CTA */}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
          >
            Read full article <IconExternalLink className="size-4" />
          </a>
        )}

        {/* More from FizzDragon */}
        {others.length > 0 && (
          <div className="mt-16 border-t border-border pt-10">
            <h2 className="mb-6 text-xl font-bold text-foreground">More from FizzDragon</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {others.map((it) => (
                <Link
                  key={it.id}
                  href={`/news/${it.id}`}
                  className="group flex flex-col transition-transform hover:-translate-y-1"
                >
                  <img
                    src={imgUrl(it.picLink)}
                    alt={it.title}
                    className="h-44 w-full rounded-xl object-cover"
                  />
                  <div className="flex flex-col gap-1.5 pt-3">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="size-1.5 rounded-full bg-primary" />
                      <span className="font-medium text-foreground">FizzDragon</span>
                      <span className="text-muted-foreground">· {timeAgo(it.createTime)}</span>
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                      {it.title}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
