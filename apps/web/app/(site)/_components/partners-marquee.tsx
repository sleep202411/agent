"use client";

/**
 * Homepage "Trusted by" / "Featured in" partner-logo wall — patterned
 * after the shadcnblocks `logos24` block: two opposing-direction
 * marquee lanes, hover-pause, gradient-mask edge fades.
 *
 * Logo files live at `public/logos/<slug>.svg|png`. Drop new files in
 * with the matching slug below and they appear automatically; until a
 * file exists the entry falls back to a uniform name-tile so the
 * grid never has hard gaps. This means we can ship the section now
 * with placeholder text and progressively replace tiles with real
 * logos as the brand team produces them.
 *
 * The list is intentionally feature-private (no API): partners are
 * a marketing-curated set, not user data.
 */

import { useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

interface Partner {
  /** Filename stem inside `public/logos/`. Component appends a list of
   *  candidate extensions (svg → png) until one resolves. */
  slug: string;
  /** Display name shown as a fallback before a logo file is uploaded. */
  name: string;
}

/**
 * 29 partners across tech / media / IP / other. Order is the legacy
 * marketing list (tech → media → IP → other) so even before logos
 * land, the marquee reads in a sensible grouping when paused.
 */
const PARTNERS: Partner[] = [
  // ─── Tech & honors ─────────────────────────────────
  { slug: "nvidia-inception", name: "NVIDIA Inception" },
  { slug: "microsoft-for-startups", name: "Microsoft for Startups" },
  { slug: "alibaba-jumpstarter", name: "Alibaba JUMPSTARTER" },
  { slug: "cyberport", name: "Cyberport" },
  { slug: "sgtech", name: "SGTech" },
  { slug: "world-internet-conference", name: "World Internet Conference" },
  { slug: "suzhou-industrial-park", name: "Suzhou Industrial Park" },

  // ─── Media ─────────────────────────────────────────
  { slug: "variety", name: "Variety" },
  { slug: "cna", name: "CNA" },
  { slug: "bloomberg", name: "Bloomberg" },
  { slug: "lianhe-zaobao", name: "Lianhe Zaobao" },
  { slug: "ne-global-media", name: "NE Global Media" },
  { slug: "nanjing-daily", name: "Nanjing Daily" },
  { slug: "china-daily", name: "China Daily" },
  { slug: "peoples-daily", name: "People's Daily" },
  { slug: "brussels-diplomatic", name: "Brussels Diplomatic" },
  { slug: "fred-film-radio", name: "FRED Film Radio" },
  { slug: "hangzhou-tv", name: "Hangzhou TV" },

  // ─── IP partners ───────────────────────────────────
  { slug: "hip-studios", name: "HIP Studios" },
  { slug: "8letters", name: "8Letters" },

  // ─── Other partners ────────────────────────────────
  { slug: "river-music-festival", name: "River Music Festival" },
  { slug: "mm2-asia", name: "mm2 Asia" },
  { slug: "future-studio", name: "Future Studio" },
  { slug: "beijing-xinghong", name: "Beijing Xinghong" },
  { slug: "cqifte", name: "Chongqing Institute of Foreign Trade & Economics" },
  { slug: "sipivt", name: "SIP Institute of Services Outsourcing" },
  { slug: "chinese-nebula-awards", name: "Chinese Nebula Awards" },
  { slug: "scifi-future-tech-center", name: "Sci-Fi & Future Tech Center" },
];

export function PartnersMarquee() {
  const t = useTranslations("home");

  // Split the 29-item list into two roughly-equal lanes so each
  // marquee row carries about half the logos. Even-indexed → top,
  // odd-indexed → bottom — interleaving keeps grouping density
  // similar between rows even though the source list is grouped
  // by category.
  const lanes: Partner[][] = [[], []];
  PARTNERS.forEach((p, i) => lanes[i % 2]!.push(p));

  return (
    <section className="relative border-t border-border/40 py-32">
      {/* Heading stays in a constrained column for readability; the
          marquee itself spills full-bleed below so the gradient fade
          masks the viewport edges, not an inner card. */}
      <div className="mx-auto max-w-6xl px-6 text-center">
        <div className="text-xs font-mono uppercase tracking-[0.25em] text-muted-foreground">
          {t("partners.eyebrow")}
        </div>
        <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          {t("partners.title")}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          {t("partners.subtitle")}
        </p>
      </div>

      <div
        className={cn(
          "relative mt-16 flex w-full flex-col gap-6",
          // Edge fade — masks the marquee tails so logos slide off
          // smoothly into the page background.
          "[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
        )}
      >
        <MarqueeRow partners={lanes[0]!} duration={60} reverse={false} />
        <MarqueeRow partners={lanes[1]!} duration={75} reverse={true} />
      </div>
    </section>
  );
}

function MarqueeRow({
  partners,
  duration,
  reverse,
}: {
  partners: Partner[];
  /** Seconds per full loop. Lower = faster scroll. The two rows use
   *  different durations so they don't sync up into a hypnotic lockstep. */
  duration: number;
  reverse: boolean;
}) {
  // Render the list twice so the -50% translate at end-of-keyframe
  // lines up the second copy exactly under the first → seamless loop.
  return (
    <div className="group/row overflow-hidden">
      <div
        className="flex w-max gap-6 group-hover/row:[animation-play-state:paused]"
        style={{
          animation: `partners-marquee ${duration}s linear infinite`,
          animationDirection: reverse ? "reverse" : "normal",
        }}
      >
        {[...partners, ...partners].map((p, i) => (
          <LogoTile key={`${p.slug}-${i}`} partner={p} />
        ))}
      </div>
    </div>
  );
}

function LogoTile({ partner }: { partner: Partner }) {
  // Try formats in order of preference (vector first → raster
  // fallbacks). When all 404 the slot renders the partner name as
  // a styled text tile so the marquee rhythm stays intact while
  // logos are still being sourced.
  const [srcIndex, setSrcIndex] = useState(0);
  const sources = [
    `/logos/${partner.slug}.svg`,
    `/logos/${partner.slug}.png`,
    `/logos/${partner.slug}.jpg`,
    `/logos/${partner.slug}.webp`,
  ];
  const exhausted = srcIndex >= sources.length;

  return (
    <div
      className="flex h-16 w-44 shrink-0 items-center justify-center rounded-lg px-4"
      title={partner.name}
    >
      {exhausted ? (
        <span className="text-center text-sm font-medium text-muted-foreground/60">
          {partner.name}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sources[srcIndex]!}
          alt={partner.name}
          className={cn(
            "max-h-10 max-w-full object-contain",
            // Monochromatic treatment + hover restores color, matching
            // the shadcnblocks `logos24` aesthetic.
            "opacity-60 grayscale transition-all duration-300",
            "hover:opacity-100 hover:grayscale-0"
          )}
          loading="lazy"
          onError={() => setSrcIndex((i) => i + 1)}
        />
      )}
    </div>
  );
}
