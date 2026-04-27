"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslations } from "@/src/i18n/i18n";
import { timeAgo, useNewsItem } from "../_hooks/use-news";

export default function NewsDetailPage() {
  const t = useTranslations("news");
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { item, all, isLoading } = useNewsItem(id);

  // External news shouldn't have a detail page — if someone hit
  // /news/<external-id>, bounce them straight to the source URL.
  useEffect(() => {
    if (item && item.isExternal && item.url && typeof window !== "undefined") {
      window.location.replace(item.url);
    }
  }, [item]);

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
        <h1 className="text-2xl font-bold text-foreground">{t("notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("notFoundDesc")}</p>
        <Link
          href="/news"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <IconArrowLeft className="size-4" /> {t("back")}
        </Link>
      </div>
    );
  }

  // External item: render a minimal "redirecting" stub while the effect
  // above kicks in. Includes a manual link as a fallback.
  if (item.isExternal && item.url) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[600px] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-muted-foreground">{t("openExternal")}</p>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("openInNewTab")} <IconExternalLink className="size-4" />
        </a>
      </div>
    );
  }

  // "More from FizzDragon" — up to 4 other internal recent items.
  const others = all.filter((it) => it.id !== item.id && !it.isExternal).slice(0, 4);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[860px] px-5 py-8 md:px-8 md:py-12">
        {/* Back link */}
        <Link
          href="/news"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconArrowLeft className="size-4" /> {t("back")}
        </Link>

        {/* Meta */}
        <div className="mb-4 flex items-center gap-2.5 text-sm">
          <span className="size-2 rounded-full bg-primary" />
          <span className="font-medium text-foreground">{item.author ?? "FizzDragon"}</span>
          <span className="text-muted-foreground">· {timeAgo(item.createTime)}</span>
        </div>

        {/* Title */}
        <h1 className="mb-6 text-3xl font-bold leading-tight text-foreground md:text-4xl">
          {item.title}
        </h1>

        {/* Hero image */}
        {item.cover && (
          <img
            src={item.cover}
            alt={item.title}
            className="mb-8 aspect-video w-full rounded-2xl object-cover"
          />
        )}

        {/* Body — markdown when present, otherwise the lede paragraph. */}
        {item.body ? (
          <div className="prose prose-invert mb-8 max-w-none text-foreground/90 prose-headings:mt-10 prose-headings:mb-4 prose-headings:text-foreground prose-h2:text-xl prose-h2:font-bold prose-p:text-foreground/85 prose-p:leading-relaxed prose-li:text-foreground/85 prose-li:leading-relaxed prose-em:text-foreground prose-strong:text-foreground prose-a:text-primary">
            <p className="text-lg leading-relaxed text-foreground">{item.info}</p>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.body}</ReactMarkdown>
          </div>
        ) : (
          item.info && (
            <p className="mb-8 whitespace-pre-line text-base leading-relaxed text-foreground/90 md:text-lg">
              {item.info}
            </p>
          )
        )}

        {/* More from FizzDragon */}
        {others.length > 0 && (
          <div className="mt-16 border-t border-border pt-10">
            <h2 className="mb-6 text-xl font-bold text-foreground">{t("more")}</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {others.map((it) => (
                <Link
                  key={it.id}
                  href={`/news/${it.id}`}
                  className="group flex flex-col transition-transform hover:-translate-y-1"
                >
                  {it.cover && (
                    <img
                      src={it.cover}
                      alt={it.title}
                      className="h-44 w-full rounded-xl object-cover"
                    />
                  )}
                  <div className="flex flex-col gap-1.5 pt-3">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="size-1.5 rounded-full bg-primary" />
                      <span className="font-medium text-foreground">
                        {it.author ?? "FizzDragon"}
                      </span>
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
