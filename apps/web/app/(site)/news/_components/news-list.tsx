"use client";

import { useState } from "react";
import Link from "next/link";
import { IconArrowUpRight, IconExternalLink } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { articleHref, formatDate } from "../_data/format";
import type { NewsItem } from "../_data/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewsList({ articles }: { articles: NewsItem[] }) {
  const t = useTranslations("news");
  const [email, setEmail] = useState("");

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(t("tInvalidEmail"));
      return;
    }
    toast.success(t("tSubscribed", { email: trimmed }));
    setEmail("");
  };

  const featured = articles[0];
  const stacked = articles.slice(1, 4);
  const rest = articles.slice(4);

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
          <form
            onSubmit={handleSubscribe}
            className="mx-auto mt-8 flex w-full max-w-md flex-col gap-2 sm:flex-row"
          >
            <input
              type="email"
              placeholder={t("subscribePlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 flex-1 rounded-xl border border-border bg-secondary/40 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              {t("subscribe")}
            </button>
          </form>
          <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">
            {t("subscribeSocialProof")}
          </p>
        </header>

        {articles.length === 0 ? (
          <div className="mt-20 text-center text-sm text-muted-foreground">{t("empty")}</div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
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
  const href = articleHref(article);
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
