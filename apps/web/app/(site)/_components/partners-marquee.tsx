"use client";

/**
 * Homepage "Trusted by" / "Featured in" partner-logo wall — patterned
 * after the shadcnblocks `logos24` block: three opposing-direction
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
  /** Filename stem inside `public/logos/` (without extension). */
  slug: string;
  /** Display name shown as a fallback before a logo file is uploaded. */
  name: string;
  /** File extension under `public/logos/<slug>.<ext>`. Required so
   *  the tile builds an exact URL — earlier versions tried svg → png →
   *  jpg → webp in turn, which produced a 404 for every PNG-only
   *  partner before the fallback resolved. Specifying the real
   *  extension keeps the network panel quiet. */
  ext: "svg" | "png";
  /** Set when the logo is a single dark colour on transparent
   *  background (e.g. recoloured-from-white wordmarks like sipivt).
   *  These are invisible on the dark theme without help — we apply
   *  `dark:invert` so the dark pixels flip to light. Leave undefined
   *  for multi-colour brand marks: inverting their hues would mangle
   *  the brand colour. */
  mono?: boolean;
}

/**
 * Partners across tech / IP / other. Order is the legacy marketing
 * list so even before logos land, the marquee reads in a sensible
 * grouping when paused.
 */
const PARTNERS: Partner[] = [
  // ─── Tech & honors ─────────────────────────────────
  { slug: "nvidia-inception", name: "NVIDIA Inception", ext: "svg" },
  // No dedicated "Microsoft for Startups" mark — fall back to the
  // generic Microsoft logo and let the hover title carry the full
  // sub-brand name.
  { slug: "microsoft", name: "Microsoft for Startups", ext: "svg" },
  // Same pattern as Microsoft — generic Alibaba mark + hover title
  // for the JUMPSTARTER sub-brand.
  { slug: "alibaba", name: "Alibaba JUMPSTARTER", ext: "svg" },
  // Separate from Alibaba JUMPSTARTER above — Alibaba Cloud is the
  // sister sub-brand that hosts our production infra (ECS).
  { slug: "alibaba-cloud", name: "Alibaba Cloud", ext: "png" },
  { slug: "cyberport", name: "Cyberport", ext: "png" },
  { slug: "sgtech", name: "SGTech", ext: "png" },
  { slug: "block71", name: "BLOCK71 (NUS Enterprise)", ext: "png" },
  { slug: "ipos-international", name: "IPOS International", ext: "png" },
  { slug: "acm", name: "ACM (Association for Computing Machinery)", ext: "png" },
  { slug: "rsm", name: "RSM", ext: "png" },
  {
    slug: "mddi",
    name: "Ministry of Digital Development and Information (Singapore)",
    ext: "png",
  },
  { slug: "mdec", name: "MDEC — Malaysia Digital Economy Corporation", ext: "png" },
  { slug: "iproa", name: "iProA — Internet Professional Association", ext: "png" },
  { slug: "enterprise-singapore", name: "Enterprise Singapore", ext: "png" },
  { slug: "ite", name: "ITE — Institute of Technical Education (Singapore)", ext: "png" },
  { slug: "cnsa", name: "CNSA — China National Space Administration", ext: "png" },
  {
    slug: "world-internet-conference",
    name: "World Internet Conference",
    ext: "png",
    mono: true,
  },
  { slug: "digital-china-summit", name: "Digital China Summit", ext: "png" },

  // ─── IP partners ───────────────────────────────────
  { slug: "hip-studios", name: "HIP Studios", ext: "png" },
  { slug: "8letters", name: "8Letters", ext: "png" },
  { slug: "stars-collective", name: "Stars Collective", ext: "png" },

  // ─── Other partners ────────────────────────────────
  { slug: "mm2-asia", name: "mm2 Asia", ext: "svg" },
  { slug: "reskills", name: "Reskills", ext: "png" },
  { slug: "hkbu", name: "Hong Kong Baptist University", ext: "png" },
  // HKAPA's source SVG had pure-white fills (extracted from a dark
  // navbar). Re-coloured to slate-800 (#1f2937) so the logo reads
  // on both light- and dark-theme page backgrounds — the marquee's
  // grayscale + opacity-60 treatment desaturates colour but
  // preserves luminance, so a mid-dark fill works in both.
  { slug: "hkapa", name: "Hong Kong Academy for Performing Arts", ext: "svg", mono: true },
  { slug: "birmingham", name: "University of Birmingham", ext: "svg" },
  { slug: "soochow", name: "Soochow University", ext: "png" },
  { slug: "lanzhou", name: "Lanzhou University", ext: "svg" },
  { slug: "sripatum", name: "Sripatum University (SPU)", ext: "svg" },
  { slug: "padua", name: "Università degli Studi di Padova", ext: "svg" },
  { slug: "cuhk", name: "The Chinese University of Hong Kong", ext: "svg" },
  { slug: "tongxing-shuyuan", name: "童行书院 Tongxing Academy", ext: "png" },
  { slug: "jscn", name: "JSCN 江苏有线", ext: "png" },
  { slug: "asia-farm", name: "Asia Farm", ext: "png" },
  { slug: "point-college", name: "POINT College", ext: "png" },
  { slug: "riff", name: "RIFF Film Festival", ext: "png" },
  { slug: "zero-wellness", name: "Zero — beyond wellness", ext: "png" },
  {
    slug: "china-intangible-heritage",
    name: "中国非物质文化遗产 China Intangible Cultural Heritage",
    ext: "png",
  },
  { slug: "shue-yan", name: "Hong Kong Shue Yan University 香港樹仁大學", ext: "png" },
  { slug: "dongfeng", name: "Dongfeng Motor 东风汽车", ext: "png" },
  { slug: "cqifte", name: "Chongqing Institute of Foreign Trade & Economics", ext: "png" },
  { slug: "sipivt", name: "SIP Institute of Services Outsourcing", ext: "png", mono: true },
  // Future Studios (Malaysia), Beijing Xinghong, Chinese Nebula Awards,
  // and the Sci-Fi & Future Tech Development Research Center are real
  // partners — but no public logo URL exists for them yet (Future
  // Studios has no domain, Xinghong/Starrise blocks scraping, Nebula
  // runs through WeChat, the research center is a sub-committee with
  // no standalone brand). Re-add entries here as the marketing team
  // sources brand-kit files; drop the file at `public/logos/<slug>.<ext>`
  // and add the entry above with its actual `ext`.
];

export function PartnersMarquee() {
  const t = useTranslations("home");

  // Split the list into three roughly-equal lanes so each marquee row
  // carries about a third of the logos. Round-robin by index keeps
  // grouping density similar between rows even though the source list
  // is grouped by category.
  const lanes: Partner[][] = [[], [], []];
  PARTNERS.forEach((p, i) => lanes[i % 3]!.push(p));

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
        <MarqueeRow partners={lanes[2]!} duration={68} reverse={false} />
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
  // Each partner declares its file extension explicitly (see the
  // `Partner` interface), so we go straight to the right URL — no
  // probe, no 404s. If `onError` fires (file missing or corrupt)
  // we fall back to a styled text tile so the marquee rhythm stays
  // intact while the asset is being fixed.
  const [errored, setErrored] = useState(false);
  const src = `/logos/${partner.slug}.${partner.ext}`;

  return (
    <div
      className="flex h-16 w-44 shrink-0 items-center justify-center rounded-lg px-4"
      title={partner.name}
    >
      {errored ? (
        <span className="text-center text-sm font-medium text-muted-foreground/60">
          {partner.name}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={partner.name}
          className={cn(
            "max-h-10 max-w-full object-contain",
            // Monochromatic treatment + hover restores color, matching
            // the shadcnblocks `logos24` aesthetic.
            "opacity-60 grayscale transition-all duration-300",
            "hover:opacity-100 hover:grayscale-0",
            // Single-colour dark logos (recoloured wordmarks etc.) are
            // invisible against the dark-theme background. Flipping
            // their luminance via `invert` puts them at the equivalent
            // contrast they have on the light theme. Hover removes the
            // invert alongside the grayscale so colour mostly recovers.
            partner.mono && "dark:invert dark:hover:invert-0"
          )}
          loading="lazy"
          onError={() => setErrored(true)}
        />
      )}
    </div>
  );
}
