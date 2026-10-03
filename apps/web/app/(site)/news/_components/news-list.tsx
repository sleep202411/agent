"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconArrowUpRight, IconExternalLink } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { articleHref, formatDate } from "../_data/format";
import { fetchNewsPage } from "../_data/news-client";
import type { NewsItem } from "../_data/types";

// The "All" pill is inserted here on the frontend — the backend has no all-tag.
// Selecting it clears the server-side `tag` filter. Sentinel id, never sent.
const ALL_TAG_ID = "all";

export function NewsList({
  articles,
  tags = [],
  initialHasMore = false,
}: {
  articles: NewsItem[];
  initialHasMore?: boolean;
  /**
   * Backend tag list (`/api/news/tags?onlyWithNews=true`) for the filter bar.
   * Empty = no bar. The "All" pill is prepended client-side; switching a real
   * tag refetches the feed from the backend (`/api/news?tag=<id>`).
   */
  tags?: { id: string; label: string }[];
}) {
  const t = useTranslations("news");
  const locale = useLocale();

  const [activeTagId, setActiveTagId] = useState(ALL_TAG_ID);
  const [displayedArticles, setDisplayedArticles] = useState(articles);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [page, setPage] = useState(1);
  const [isPending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  const loadedTagRef = useRef(ALL_TAG_ID);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    []
  );

  const load = async (tagId: string, nextPage: number, append: boolean) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const next = await fetchNewsPage(locale, tagId, nextPage, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      loadedTagRef.current = tagId;
      setDisplayedArticles((current) => {
        if (!append) return next.items;
        const seen = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...next.items.filter((item) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          }),
        ];
      });
      setHasMore(next.hasMore);
      setPage(nextPage);
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) {
        setActiveTagId(loadedTagRef.current);
        toast.error(error instanceof Error && error.message ? error.message : t("tFilterFailed"));
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };
  const selectTag = (tagId: string) => {
    if (tagId === activeTagId) return;
    setActiveTagId(tagId);
    if (tagId === ALL_TAG_ID) {
      request.current?.abort();
      request.current = null;
      setPending(false);
      loadedTagRef.current = ALL_TAG_ID;
      setDisplayedArticles(articles);
      setHasMore(initialHasMore);
      setPage(1);
      return;
    }
    void load(tagId, 1, false);
  };

  const featured = displayedArticles[0];
  const stacked = displayedArticles.slice(1, 4);
  const rest = displayedArticles.slice(4);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-5 py-12 md:px-8 md:py-20">
        {/* Hero */}
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground md:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground md:text-base">
            {t("subtitle")}
          </p>
        </header>

        {/* Tag pills — the "All" pill is prepended client-side; switching a real
            tag refetches the feed from the backend. No navigation, no URL change. */}
        {tags.length > 0 && (
          <nav
            className="mt-10 flex flex-wrap items-center justify-center gap-2"
            aria-busy={isPending}
          >
            <TagPill active={activeTagId === ALL_TAG_ID} onClick={() => selectTag(ALL_TAG_ID)}>
              {t("categoryAll")}
            </TagPill>
            {tags.map((tag) => (
              <TagPill
                key={tag.id}
                active={activeTagId === tag.id}
                onClick={() => selectTag(tag.id)}
              >
                {tag.label}
              </TagPill>
            ))}
          </nav>
        )}

        {isPending && displayedArticles.length === 0 ? (
          <div className="mt-20 flex justify-center">
            <span className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          </div>
        ) : displayedArticles.length === 0 ? (
          <div className="mt-20 text-center text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          <div className={cn("transition-opacity", isPending && "pointer-events-none opacity-40")}>
            {/* Recent blog posts */}
            <section className="mt-16 md:mt-24">
              <h2 className="mb-8 text-lg font-bold text-foreground">{t("recent")}</h2>
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {featured && <FeaturedCard article={featured} />}
                <div className="flex flex-col gap-6">
                  {stacked.map((a) => (
                    <RowCard key={a.id} article={a} />
                  ))}
                </div>
              </div>
            </section>

            {/* All blog posts */}
            {rest.length > 0 && (
              <section className="mt-20 md:mt-24">
                <h2 className="mb-8 text-lg font-bold text-foreground">{t("all")}</h2>
                <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
                  {rest.map((a) => (
                    <GridCard key={a.id} article={a} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
        {hasMore && (
          <div className="mt-10 flex justify-center">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!request.current) void load(activeTagId, page + 1, true);
              }}
              className="rounded-full bg-secondary px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
            >
              {isPending ? t("loadingMore") : t("loadMore")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tag pill ─────────────────────────────────────────
//
// A <button>: tags filter the feed by refetching from the backend, they don't
// navigate, so there is no href and no shareable URL by design.

function TagPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-secondary/40 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// ─── Routing wrapper ──────────────────────────────────
//
// Internal articles → next/link to /news/[id].
// External news items → plain <a target="_blank">.

function ArticleLink({
  article,
  className,
  children,
}: {
  article: NewsItem;
  className?: string;
  children: React.ReactNode;
}) {
  const locale = useLocale();
  const href = article.isExternal ? articleHref(article) : `/${locale}${articleHref(article)}`;
  if (article.isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// ─── Bits ─────────────────────────────────────────────

function Meta({ article }: { article: NewsItem }) {
  const t = useTranslations("news");
  return (
    <div className="text-xs font-medium text-primary">
      <span>{article.author ?? "FizzDragon"}</span>
      <span className="mx-1.5 text-muted-foreground">·</span>
      <span className="text-muted-foreground">{formatDate(article.createTime)}</span>
      {article.isExternal && (
        <>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <IconExternalLink className="size-3" /> {t("external")}
          </span>
        </>
      )}
    </div>
  );
}

function ArrowIcon({ external }: { external: boolean }) {
  const Icon = external ? IconExternalLink : IconArrowUpRight;
  return (
    <Icon className="mt-1 size-5 shrink-0 text-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
  );
}

// ─── Cards ────────────────────────────────────────────

function FeaturedCard({ article }: { article: NewsItem }) {
  return (
    <ArticleLink
      article={article}
      className="group flex flex-col gap-5 transition-transform hover:-translate-y-1"
    >
      <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl bg-secondary">
        {article.cover && (
          <img
            src={article.cover}
            alt={article.title}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <Meta article={article} />
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold leading-tight text-foreground transition-colors group-hover:text-primary md:text-2xl">
            {article.title}
          </h3>
          <ArrowIcon external={article.isExternal} />
        </div>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{article.info}</p>
      </div>
    </ArticleLink>
  );
}

function RowCard({ article }: { article: NewsItem }) {
  return (
    <ArticleLink article={article} className="group flex items-start gap-5">
      <div className="aspect-[4/3] w-32 shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-40 md:w-48">
        {article.cover && (
          <img
            src={article.cover}
            alt={article.title}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Meta article={article} />
        <div className="flex items-start justify-between gap-3">
          <h4 className="line-clamp-2 text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
            {article.title}
          </h4>
          <ArrowIcon external={article.isExternal} />
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{article.info}</p>
      </div>
    </ArticleLink>
  );
}

function GridCard({ article }: { article: NewsItem }) {
  return (
    <ArticleLink
      article={article}
      className="group flex flex-col gap-5 transition-transform hover:-translate-y-1"
    >
      <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl bg-secondary">
        {article.cover && (
          <img
            src={article.cover}
            alt={article.title}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        <Meta article={article} />
        <div className="flex items-start justify-between gap-3">
          <h4 className="line-clamp-2 text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
            {article.title}
          </h4>
          <ArrowIcon external={article.isExternal} />
        </div>
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{article.info}</p>
      </div>
    </ArticleLink>
  );
}
