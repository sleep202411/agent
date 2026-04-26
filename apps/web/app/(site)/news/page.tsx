"use client";

import Link from "next/link";
import { imgUrl, timeAgo, parseSections, useNewsData, type NewsItem } from "./_hooks/use-news";

// ─── Component ────────────────────────────────────────

export default function NewsPage() {
  const { data, isLoading } = useNewsData();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!data) return null;

  const bannerBig = data["banner-Big"] ?? [];
  const bannerSmall = data["banner-Small"] ?? [];
  const featured = bannerBig[0];
  const latestNews = bannerSmall.slice(0, 4);
  const mustRead = [bannerBig[1], bannerBig[2], bannerBig[3], bannerSmall[4]].filter(
    Boolean
  ) as NewsItem[];
  const dualSections = parseSections(data);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-5 py-8 md:px-8 md:py-10">
        {/* Featured Article */}
        {featured && (
          <Link
            href={`/news/${featured.id}`}
            className="group mb-12 flex flex-col gap-6 md:mb-16 md:flex-row md:gap-8"
          >
            <img
              src={imgUrl(featured.picLink)}
              alt={featured.title}
              className="h-60 w-full rounded-xl object-cover md:h-80 md:w-1/2"
            />
            <div className="flex flex-col justify-center gap-3">
              <div className="flex items-center gap-2.5">
                <span className="size-2 rounded-full bg-primary" />
                <span className="text-sm font-medium text-foreground">FizzDragon</span>
                <span className="text-sm text-muted-foreground">
                  · {timeAgo(featured.createTime)}
                </span>
              </div>
              <h1 className="text-2xl font-bold leading-tight text-foreground md:text-3xl">
                {featured.title}
              </h1>
              <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                {featured.info}
              </p>
            </div>
          </Link>
        )}

        {/* Latest News */}
        {latestNews.length > 0 && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-foreground">Latest News</h2>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {latestNews.map((item) => (
                <Link
                  key={item.id}
                  href={`/news/${item.id}`}
                  className="group flex flex-col transition-transform hover:-translate-y-1"
                >
                  <img
                    src={imgUrl(item.picLink)}
                    alt={item.title}
                    className="h-48 w-full rounded-xl object-cover lg:h-44"
                  />
                  <div className="flex flex-col gap-2 pt-3.5">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-primary" />
                      <span className="text-xs font-medium text-foreground">FizzDragon</span>
                      <span className="text-xs text-muted-foreground">
                        · {timeAgo(item.createTime)}
                      </span>
                    </div>
                    <h3 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
                      {item.title}
                    </h3>
                    <p className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
                      {item.info}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* Must Read */}
        {mustRead.length >= 4 && (
          <div className="mt-16">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-foreground">Must Read</h2>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.5fr_minmax(0,300px)]">
              {/* Col 1 */}
              <Link
                href={`/news/${mustRead[0].id}`}
                className="group flex flex-col transition-transform hover:-translate-y-1 lg:self-start"
              >
                <div className="aspect-square w-full shrink-0 overflow-hidden rounded-xl">
                  <img
                    src={imgUrl(mustRead[0].picLink)}
                    alt={mustRead[0].title}
                    className="size-full object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2 pt-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-foreground">FizzDragon</span>
                    <span className="text-muted-foreground">
                      · {timeAgo(mustRead[0].createTime)}
                    </span>
                  </div>
                  <h3 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
                    {mustRead[0].title}
                  </h3>
                  <p className="line-clamp-4 text-[13px] leading-relaxed text-muted-foreground">
                    {mustRead[0].info}
                  </p>
                </div>
              </Link>

              {/* Col 2 — overlay */}
              <Link
                href={`/news/${mustRead[1].id}`}
                className="group relative self-start overflow-hidden rounded-xl transition-transform hover:-translate-y-1"
              >
                <div className="aspect-square w-full">
                  <img
                    src={imgUrl(mustRead[1].picLink)}
                    alt={mustRead[1].title}
                    className="size-full object-cover"
                  />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5">
                  <div className="flex items-center gap-2 text-xs text-white/80">
                    <span className="font-medium">FizzDragon</span>
                    <span>· {timeAgo(mustRead[1].createTime)}</span>
                  </div>
                  <h3 className="line-clamp-2 text-lg font-bold leading-snug text-white">
                    {mustRead[1].title}
                  </h3>
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-white/70">
                    {mustRead[1].info}
                  </p>
                </div>
              </Link>

              {/* Col 3 — two stacked */}
              <div className="flex flex-col gap-4 sm:flex-row sm:gap-5 lg:flex-col lg:self-stretch">
                {mustRead.slice(2, 4).map((item) => (
                  <Link
                    key={item.id}
                    href={`/news/${item.id}`}
                    className="group flex flex-1 flex-col transition-transform hover:-translate-y-1"
                  >
                    <div className="aspect-[5/2] w-full shrink-0 overflow-hidden rounded-xl">
                      <img
                        src={imgUrl(item.picLink)}
                        alt={item.title}
                        className="size-full object-cover"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 pt-2.5">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="size-1.5 rounded-full bg-primary" />
                        <span className="font-medium text-foreground">FizzDragon</span>
                        <span className="text-muted-foreground">· {timeAgo(item.createTime)}</span>
                      </div>
                      <h4 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                        {item.title}
                      </h4>
                      {item.info && (
                        <p className="line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
                          {item.info}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Dual Sections */}
        {dualSections.length >= 2 && (
          <div className="mt-16 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-5">
            {dualSections.slice(0, 2).map((section) => (
              <div key={section.name}>
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-xl font-bold text-foreground">{section.title}</h2>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  {section.items.map((item) => (
                    <Link
                      key={item.id}
                      href={`/news/${item.id}`}
                      className="group flex flex-col transition-transform hover:-translate-y-1"
                    >
                      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl">
                        <img
                          src={imgUrl(item.picLink)}
                          alt={item.title}
                          className="size-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 pt-3">
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className="size-1.5 rounded-full bg-primary" />
                          <span className="font-medium text-foreground">FizzDragon</span>
                          <span className="text-muted-foreground">
                            · {timeAgo(item.createTime)}
                          </span>
                        </div>
                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                          {item.title}
                        </h3>
                        <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                          {item.info}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Subscribe Section */}
        <div className="mt-16 rounded-2xl bg-muted px-6 py-10 md:px-12 md:py-12">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Get First Update
              </p>
              <h2 className="text-xl font-bold leading-snug text-foreground md:text-2xl">
                Get the news in front line by <span className="text-primary">subscribe</span> our
                latest updates
              </h2>
            </div>
            <div className="flex w-full shrink-0 gap-3 lg:w-auto">
              <input
                type="email"
                placeholder="Your email"
                className="h-12 w-full min-w-0 rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 lg:w-64"
              />
              <button className="h-12 shrink-0 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                Subscribe
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
