"use client";

/**
 * "Made with FizzDragon" — homepage wall of in-production community IPs, shown
 * as two opposing-direction marquee rows of landscape key-art posters
 * (hover-pause, edge-fade), patterned after `partners-marquee`. Clicking a
 * poster opens a bottom drawer with the full art + title + description, and
 * either a deep-link CTA or a "coming soon" state.
 *
 * Feature-private STATIC showcase (deliberately NOT the live IP catalogue API):
 *   • Posters live in `public/made-with-fizz/<slug>.jpg`.
 *   • Title + description copy is per-locale (中/英/繁), stored in the i18n
 *     catalogs under `home.madeWithFizz.stories.<slug>.{title,description}`.
 *   • `editions` gates which deployment shows each IP — `.cn` (mainland) vs
 *     `global` (.com / overseas), keyed off NEXT_PUBLIC_SITE_REGION.
 *
 * To add an IP: drop the poster, add a row to STORIES (slug + optional href +
 * optional editions), and add its 3-locale title/description to the catalogs.
 */

import { useState } from "react";
import Link from "next/link";
import { IconArrowRight, IconX } from "@tabler/icons-react";
import {
  Sheet,
  SheetContent,
  SheetClose,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

type Edition = "cn" | "global";

interface Story {
  /** i18n key segment (home.madeWithFizz.stories.<slug>) AND, when `cover` is
   *  omitted, the local poster stem (public/made-with-fizz/<slug>.jpg). */
  slug: string;
  /** Full poster URL (e.g. an IP's catalogue cover). Omit to use the local
   *  poster at public/made-with-fizz/<slug>.jpg. */
  cover?: string;
  /** Optional deep link; when set the drawer shows a CTA, else "coming soon". */
  href?: string;
  /** Which deployments show this IP. Omit = both. */
  editions?: Edition[];
}

// Curated showcase. Copy is in messages/<locale>.json under
// `home.madeWithFizz.stories.<slug>`. Tag `editions: ["cn"]` / `["global"]` to
// scope an IP to one deployment; omit to show on both.
const BLOB =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/ip-bulk-seed/image/2026/06/23";
const STORIES: Story[] = [
  // Live catalogue IPs (real cover + deep link to /ips/<id>).
  {
    slug: "seed-100",
    cover: `${BLOB}/aa917911-499a-58b6-83b9-45d4a34a3b20.webp`,
    href: "/ips/8d338b98-4039-592c-9d61-be4ae7916bfd",
  },
  {
    slug: "seed-102",
    cover: `${BLOB}/40995ded-50f5-5650-a06d-380f6897c0e5.webp`,
    href: "/ips/0ed0bc92-34df-54b7-aa8a-1135f170b5c6",
  },
  {
    slug: "seed-103",
    cover: `${BLOB}/e7a8c14c-6b4e-573e-be73-31ae5c7d60a3.webp`,
    href: "/ips/c1bb78cc-aecd-5069-a8d9-1c90a35004db",
  },
  {
    slug: "seed-104",
    cover: `${BLOB}/3eda358d-966a-50b8-907f-e776420f54a2.webp`,
    href: "/ips/a48c3a5c-d8d9-5264-a65d-bc243da18304",
  },
  {
    slug: "seed-107",
    cover: `${BLOB}/f434725d-cfa6-5353-ba40-1962f191d4c1.webp`,
    href: "/ips/a33c40fe-74d2-5d30-a4b6-b078ea213fd5",
  },
  {
    slug: "seed-108",
    cover: `${BLOB}/b741ef5e-3818-519a-b36f-97c1e438f832.webp`,
    href: "/ips/937643bc-b945-5dc6-96d1-1811dbb07ace",
  },
  {
    slug: "seed-113",
    cover: `${BLOB}/fab3783f-f215-598f-8762-c7f5c13e883f.webp`,
    href: "/ips/226a0db8-24be-5d4d-b929-c6c1800d1137",
  },
  {
    slug: "seed-114",
    cover: `${BLOB}/10e91b3c-b3cb-5fe7-9a72-39ef638f1cb6.webp`,
    href: "/ips/1e0cf49b-ebfc-5d28-896f-924003b955fc",
  },
  {
    slug: "seed-117",
    cover: `${BLOB}/92bfd9f7-fb8a-5061-a847-9c69e89e5b4d.webp`,
    href: "/ips/7bbdea7e-31de-5fa2-a141-a54862299fdf",
  },
  {
    slug: "seed-119",
    cover: `${BLOB}/1a606ffa-e8fd-598d-b4f4-3d72e68b862c.webp`,
    href: "/ips/ba88f3ff-cf88-5c06-9df8-ceba6119dd51",
  },
  {
    slug: "seed-120",
    cover: `${BLOB}/02837fa3-525e-5838-be82-cf68290284da.webp`,
    href: "/ips/86ff2532-a2a9-51e2-9d1f-e84901f0d9e0",
  },
  {
    slug: "seed-121",
    cover: `${BLOB}/40effb1f-0bd4-56a1-b51c-a6fc6a409383.webp`,
    href: "/ips/e979a1c2-e93d-5ff1-b520-12f38b825f6b",
  },
  {
    slug: "seed-124",
    cover: `${BLOB}/d7d29484-b8a6-5cf3-bf3c-e3fa23cf691b.webp`,
    href: "/ips/ef4ee7fd-96b9-58dc-8e54-cc413ce21f33",
  },
  {
    slug: "seed-110",
    cover: `${BLOB}/088ac7cc-19c1-57df-8aa8-2b250d96642e.webp`,
    href: "/ips/aad96aa7-6a37-5936-b321-9bc43833f424",
  },
  // Curated local posters (public/made-with-fizz/<slug>.jpg) — coming soon.
  { slug: "the-predator" },
  { slug: "three-second-world" },
  { slug: "children-eighth-day" },
  { slug: "lunar-colony" },
  { slug: "guizhou-fast-earth-core" },
  { slug: "city-of-measuring-tapes" },
  { slug: "twin-cities-hong-kong" },
];

// .cn (mainland) vs global (.com). NEXT_PUBLIC_SITE_REGION is inlined at build,
// so this is a per-deployment constant — read it directly (client-safe).
const EDITION: Edition = process.env.NEXT_PUBLIC_SITE_REGION === "cn" ? "cn" : "global";

interface ResolvedStory {
  slug: string;
  cover: string;
  title: string;
  description: string;
  status: string;
  href?: string;
}

export function MadeWithFizz() {
  const locale = useLocale() as Locale;
  const t = useTranslations("home");
  const [selected, setSelected] = useState<ResolvedStory | null>(null);

  const stories: ResolvedStory[] = STORIES.filter(
    (s) => !s.editions || s.editions.includes(EDITION)
  ).map((s) => ({
    slug: s.slug,
    href: s.href,
    cover: s.cover ?? `/made-with-fizz/${s.slug}.jpg`,
    title: t(`madeWithFizz.stories.${s.slug}.title`),
    description: t(`madeWithFizz.stories.${s.slug}.description`),
    status: s.href ? t("madeWithFizz.inProduction") : t("madeWithFizz.comingSoon"),
  }));

  if (stories.length === 0) return null;

  // Two DISJOINT lanes (even / odd index) scrolling in opposite directions, so
  // the top and bottom rows show different posters instead of mirroring.
  const laneA = stories.filter((_, i) => i % 2 === 0);
  const laneB = stories.filter((_, i) => i % 2 === 1);

  // Duration scales with each lane's card count so the pixels-per-second drift
  // stays constant however many posters there are. The two lanes use slightly
  // different durations so they never lock into step. Higher = slower.
  const SECONDS_PER_CARD = 7;
  const durationA = Math.round(laneA.length * SECONDS_PER_CARD);
  const durationB = Math.round(laneB.length * SECONDS_PER_CARD * 1.18);

  return (
    <section className="relative overflow-hidden border-t border-border/40 py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground">
              {t("madeWithFizz.eyebrow")}
            </div>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              {t("madeWithFizz.title")}
            </h2>
            <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
              {t("madeWithFizz.subtitle")}
            </p>
          </div>
          <Link
            href={localizePath("/ips", locale)}
            className="group inline-flex items-center gap-1.5 self-start rounded-full border border-border/50 bg-card/40 px-4 py-2 text-sm text-foreground/80 transition-colors hover:border-border hover:text-foreground sm:self-end"
          >
            {t("madeWithFizz.viewAll")}
            <IconArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>

      <div className="mt-14 flex flex-col gap-4 mask-[linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
        <MarqueeRow stories={laneA} duration={durationA} onOpen={setSelected} />
        <MarqueeRow stories={laneB} duration={durationB} reverse onOpen={setSelected} />
      </div>

      <StoryDrawer story={selected} locale={locale} onClose={() => setSelected(null)} t={t} />
    </section>
  );
}

function MarqueeRow({
  stories,
  duration,
  reverse,
  onOpen,
}: {
  stories: ResolvedStory[];
  duration: number;
  reverse?: boolean;
  onOpen: (s: ResolvedStory) => void;
}) {
  // Two back-to-back copies so a -50% translate loops seamlessly.
  const track = [...stories, ...stories];
  return (
    <div className="group/row overflow-hidden">
      <div
        className="flex w-max gap-4 px-2 group-hover/row:paused motion-reduce:paused"
        style={{
          animation: `partners-marquee ${duration}s linear infinite`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        {track.map((story, i) => (
          <Card
            key={`${story.slug}-${i}`}
            story={story}
            onOpen={onOpen}
            ariaHidden={i >= stories.length}
          />
        ))}
      </div>
    </div>
  );
}

function Card({
  story,
  onOpen,
  ariaHidden,
}: {
  story: ResolvedStory;
  onOpen: (s: ResolvedStory) => void;
  ariaHidden: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(story)}
      aria-hidden={ariaHidden}
      tabIndex={ariaHidden ? -1 : undefined}
      aria-label={story.title}
      className="group relative block w-[clamp(260px,28vw,400px)] shrink-0 overflow-hidden rounded-2xl border border-border/50 bg-card text-left transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-lg hover:shadow-black/20"
    >
      <div className="relative aspect-video overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={story.cover}
          alt={story.title}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/85 via-black/15 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
          <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90 ring-1 ring-white/10 backdrop-blur-sm">
            <span
              className={cn(
                "size-1.5 rounded-full",
                story.href ? "bg-emerald-400" : "bg-amber-300/80"
              )}
            />
            {story.status}
          </span>
          <div className="truncate text-sm font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
            {story.title}
          </div>
        </div>
      </div>
    </button>
  );
}

function StoryDrawer({
  story,
  locale,
  onClose,
  t,
}: {
  story: ResolvedStory | null;
  locale: Locale;
  onClose: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <Sheet open={!!story} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto max-h-[92vh] max-w-3xl overflow-y-auto rounded-t-2xl p-0 text-sm"
        // Poster viewer (not a form) — allow click-outside / Esc to close.
        onPointerDownOutside={() => undefined}
        onInteractOutside={() => undefined}
      >
        {story ? (
          <div className="relative">
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-3 top-3 z-10 bg-black/40 text-white backdrop-blur-sm hover:bg-black/60 hover:text-white"
              >
                <IconX />
                <span className="sr-only">Close</span>
              </Button>
            </SheetClose>

            <div className="aspect-video w-full overflow-hidden bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={story.cover} alt={story.title} className="size-full object-cover" />
            </div>

            <div className="space-y-4 p-6 sm:p-8">
              <SheetTitle className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {story.title}
              </SheetTitle>
              <SheetDescription className="text-base/relaxed text-muted-foreground">
                {story.description}
              </SheetDescription>

              <div className="pt-2">
                {story.href ? (
                  <Link
                    href={localizePath(story.href, locale)}
                    className="group inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                  >
                    {t("madeWithFizz.enter")}
                    <IconArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-border/60 px-5 py-2.5 text-sm font-medium text-muted-foreground">
                    {t("madeWithFizz.comingSoon")}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
