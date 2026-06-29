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
const STORIES: Story[] = [
  // .com (global) — catalogue IPs
  {
    slug: "ip-226a0db8",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/456b53e0-ac6f-59b6-bda6-377f01b04379.webp",
    href: "/ips/226a0db8-24be-5d4d-b929-c6c1800d1137",
    editions: ["global"],
  },
  {
    slug: "ip-45646f1c",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/abf68f0e-c8a7-5534-a0d7-aa4c6c34f763.webp",
    href: "/ips/45646f1c-92bd-5e57-8413-3dba4b7e7426",
    editions: ["global"],
  },
  {
    slug: "ip-d387e452",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/ca0cebc9-3204-5333-94a5-5500d7363229.webp",
    href: "/ips/d387e452-edba-53ab-9557-5e647061b34f",
    editions: ["global"],
  },
  {
    slug: "ip-ad1ac5da",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/9a10d35f-2acb-5882-96db-2a80af336b3c.webp",
    href: "/ips/ad1ac5da-c4e4-5dec-8576-48ae85693294",
    editions: ["global"],
  },
  {
    slug: "ip-2eddb763",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/f9f8dc6e-2b69-5e39-9ffb-b689a250a4eb.webp",
    href: "/ips/2eddb763-a259-52d5-bef4-a7ade100c57c",
    editions: ["global"],
  },
  {
    slug: "ip-7bbdea7e",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/66158a61-bd45-5d1b-94d4-b9d48ddc5155.webp",
    href: "/ips/7bbdea7e-31de-5fa2-a141-a54862299fdf",
    editions: ["global"],
  },
  {
    slug: "ip-ad168289",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-commerce/migrated/ad168289-d702-56cc-81ad-cdcdf7f3fb1a/cover/7d9a4e15-28bf-58be-a12d-79166ccd03de-ip_banner_1777822425157_4f8cc38bd127.jpg",
    href: "/ips/ad168289-d702-56cc-81ad-cdcdf7f3fb1a",
    editions: ["global"],
  },
  {
    slug: "ip-aa216545",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/7126a35f-5419-53a3-b7d7-68709124edbe.webp",
    href: "/ips/aa216545-4748-522c-badd-10432a3f8e61",
    editions: ["global"],
  },
  {
    slug: "ip-65f7d572",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/468c8ebf-3f30-56d8-bd9f-fe61d327d4b6.webp",
    href: "/ips/65f7d572-bf98-56b8-bbb1-2f506029888c",
    editions: ["global"],
  },
  {
    slug: "ip-889a2bdc",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-commerce/migrated/889a2bdc-fe9b-5120-bd6c-d48e6e480753/cover/f24f4610-cbcc-57ff-a0d9-ca8ce5968161-ip_banner_1778672138290_027863dc01ae.png",
    href: "/ips/889a2bdc-fe9b-5120-bd6c-d48e6e480753",
    editions: ["global"],
  },
  {
    slug: "ip-4158fbae",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-commerce/migrated/4158fbae-ad10-56af-ba65-113fb60d0fa4/cover/7c64ba9e-d3e5-55f6-a8f5-67fe05ce3d0a-ip_banner_1778132525296_d58cf0456a3f.jpg",
    href: "/ips/4158fbae-ad10-56af-ba65-113fb60d0fa4",
    editions: ["global"],
  },
  {
    slug: "ip-d69608b4",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-commerce/migrated/d69608b4-1b80-55c5-b9f2-3b86d8830008/cover/9e255aa1-8108-55f8-86d2-61972dfb1cf2-ip_banner_1779044901141_d65e9ed783a7.png",
    href: "/ips/d69608b4-1b80-55c5-b9f2-3b86d8830008",
    editions: ["global"],
  },
  {
    slug: "ip-019ef8c1",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/media/global/ip-banner/15/2026/06/24/a76a879e-9a7e-4560-a909-96c167f21a8b.png",
    href: "/ips/019ef8c1-e54a-71ca-b14b-b4bf9f25bb84",
    editions: ["global"],
  },
  {
    slug: "ip-1e0cf49b",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/ec22b48f-67c5-5033-afda-1f02299fe7f1.webp",
    href: "/ips/1e0cf49b-ebfc-5d28-896f-924003b955fc",
    editions: ["global"],
  },
  {
    slug: "ip-23293bcf",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/eb843689-ba38-5e06-9b8c-044e8806e56c.webp",
    href: "/ips/23293bcf-3517-5921-88e9-64cfbd3088b6",
    editions: ["global"],
  },
  {
    slug: "ip-3d9dfdc7",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/3989eecb-fbb1-5284-96cc-7618df10896f.webp",
    href: "/ips/3d9dfdc7-d955-5858-a21b-819de5e0e898",
    editions: ["global"],
  },
  {
    slug: "ip-6ef42201",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/143fabe5-6deb-5c50-82ab-f62cae366dbd.webp",
    href: "/ips/6ef42201-26d4-5693-b373-5273d65b7253",
    editions: ["global"],
  },
  {
    slug: "ip-5040a3c5",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/48f3047a-559c-54c9-9b31-410222cb1607.webp",
    href: "/ips/5040a3c5-9806-51f5-a8a6-daf12e789a5c",
    editions: ["global"],
  },
  {
    slug: "ip-8bf2ceab",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/bf4fedc5-73f6-5446-a7bc-b7add58fa77b.webp",
    href: "/ips/8bf2ceab-a4ac-5e80-af4f-4aeebc7a1076",
    editions: ["global"],
  },
  {
    slug: "ip-5cd1914c",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/17305223-885d-5e2c-bf04-52f0b67177fa.webp",
    href: "/ips/5cd1914c-3a2d-5879-be56-5314d253119e",
    editions: ["global"],
  },
  {
    slug: "ip-b1ffcf6e",
    cover:
      "https://media.fizzdragon.com/foundry-outputs/ip-bulk-seed/visual-prompt-20260628/9d3cb9ab-cd8f-5607-9372-ecf571225543.webp",
    href: "/ips/b1ffcf6e-1f97-5008-a53d-24b54b9c4091",
    editions: ["global"],
  },
  // .cn (mainland) — catalogue IPs
  {
    slug: "ipcn-1e0cf49b",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/ec22b48f-67c5-5033-afda-1f02299fe7f1.webp",
    href: "/ips/1e0cf49b-ebfc-5d28-896f-924003b955fc",
    editions: ["cn"],
  },
  {
    slug: "ipcn-226a0db8",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/456b53e0-ac6f-59b6-bda6-377f01b04379.webp",
    href: "/ips/226a0db8-24be-5d4d-b929-c6c1800d1137",
    editions: ["cn"],
  },
  {
    slug: "ipcn-7bbdea7e",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/66158a61-bd45-5d1b-94d4-b9d48ddc5155.webp",
    href: "/ips/7bbdea7e-31de-5fa2-a141-a54862299fdf",
    editions: ["cn"],
  },
  {
    slug: "ipcn-e979a1c2",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/adf99410-2688-5399-b9d9-6ce575276de5.webp",
    href: "/ips/e979a1c2-e93d-5ff1-b520-12f38b825f6b",
    editions: ["cn"],
  },
  {
    slug: "ipcn-a5a9e182",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/afb7290d-f2a5-51be-9799-c9a63fc0a000.webp",
    href: "/ips/a5a9e182-42e2-5bd7-9545-0343bb264065",
    editions: ["cn"],
  },
  {
    slug: "ipcn-45646f1c",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/abf68f0e-c8a7-5534-a0d7-aa4c6c34f763.webp",
    href: "/ips/45646f1c-92bd-5e57-8413-3dba4b7e7426",
    editions: ["cn"],
  },
  {
    slug: "ipcn-23293bcf",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/eb843689-ba38-5e06-9b8c-044e8806e56c.webp",
    href: "/ips/23293bcf-3517-5921-88e9-64cfbd3088b6",
    editions: ["cn"],
  },
  {
    slug: "ipcn-3d9dfdc7",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/3989eecb-fbb1-5284-96cc-7618df10896f.webp",
    href: "/ips/3d9dfdc7-d955-5858-a21b-819de5e0e898",
    editions: ["cn"],
  },
  {
    slug: "ipcn-79a7af3d",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/a5d6b899-ea3f-5b49-883f-259273fa9bd1.webp",
    href: "/ips/79a7af3d-02e4-5c31-bf12-e2296a29887f",
    editions: ["cn"],
  },
  {
    slug: "ipcn-d387e452",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/ca0cebc9-3204-5333-94a5-5500d7363229.webp",
    href: "/ips/d387e452-edba-53ab-9557-5e647061b34f",
    editions: ["cn"],
  },
  {
    slug: "ipcn-2737f775",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/32a3e50f-e262-5d3a-a5f7-1218a02a0f41.webp",
    href: "/ips/2737f775-e3cc-560c-a728-9477b9dd50da",
    editions: ["cn"],
  },
  {
    slug: "ipcn-54d61e27",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/98bd7665-e40c-50ab-a72b-479f2b6bf911.webp",
    href: "/ips/54d61e27-0ed3-5499-bf0d-675ec0236642",
    editions: ["cn"],
  },
  {
    slug: "ipcn-94c0f083",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/0d2cc7c2-121e-5eb5-9c39-8647f81155f0.webp",
    href: "/ips/94c0f083-7b65-52fa-bd96-b5d0e3a7b3ef",
    editions: ["cn"],
  },
  {
    slug: "ipcn-8bf2ceab",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/bf4fedc5-73f6-5446-a7bc-b7add58fa77b.webp",
    href: "/ips/8bf2ceab-a4ac-5e80-af4f-4aeebc7a1076",
    editions: ["cn"],
  },
  {
    slug: "ipcn-3ad64bd9",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/75741165-52ab-51bf-9ace-761034da8296.webp",
    href: "/ips/3ad64bd9-b752-5d4f-9990-254aac874009",
    editions: ["cn"],
  },
  {
    slug: "ipcn-ad1ac5da",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/9a10d35f-2acb-5882-96db-2a80af336b3c.webp",
    href: "/ips/ad1ac5da-c4e4-5dec-8576-48ae85693294",
    editions: ["cn"],
  },
  {
    slug: "ipcn-af2a5a4c",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/e0d536cc-12ec-5bfa-b25e-0eedc2152895.webp",
    href: "/ips/af2a5a4c-1f21-5e71-a8cb-391386bc8d79",
    editions: ["cn"],
  },
  {
    slug: "ipcn-b1ffcf6e",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/9d3cb9ab-cd8f-5607-9372-ecf571225543.webp",
    href: "/ips/b1ffcf6e-1f97-5008-a53d-24b54b9c4091",
    editions: ["cn"],
  },
  {
    slug: "ipcn-294324f5",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/8ca838eb-29e5-503b-967c-71a9a7bfed27.webp",
    href: "/ips/294324f5-0b73-5d6a-b7ba-6143e9f63a21",
    editions: ["cn"],
  },
  {
    slug: "ipcn-65f7d572",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/468c8ebf-3f30-56d8-bd9f-fe61d327d4b6.webp",
    href: "/ips/65f7d572-bf98-56b8-bbb1-2f506029888c",
    editions: ["cn"],
  },
  {
    slug: "ipcn-42d5f6ab",
    cover:
      "https://media.fizzspace.cn/ip-bulk-seed/visual-prompt-20260628/99261269-9f1d-5aa7-8b15-93bd7e9766f3.webp",
    href: "/ips/42d5f6ab-7c85-5b67-8e8d-553c68da7dae",
    editions: ["cn"],
  },
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
