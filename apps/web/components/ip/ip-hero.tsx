import { Link } from "@tanstack/react-router";
import { IconSearch, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

// Scattered cover images around the hero
const COVERS = [
  // Left side
  {
    src: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=200&q=80",
    x: "2%",
    y: "8%",
    rotate: -12,
    size: "w-28",
  },
  {
    src: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=200&q=80",
    x: "1%",
    y: "45%",
    rotate: 8,
    size: "w-24",
  },
  {
    src: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200&q=80",
    x: "8%",
    y: "72%",
    rotate: -6,
    size: "w-26",
  },
  {
    src: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=200&q=80",
    x: "14%",
    y: "20%",
    rotate: 15,
    size: "w-20",
  },
  {
    src: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=200&q=80",
    x: "12%",
    y: "58%",
    rotate: -18,
    size: "w-22",
  },
  // Right side
  {
    src: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&q=80",
    x: "78%",
    y: "10%",
    rotate: 10,
    size: "w-26",
  },
  {
    src: "https://images.unsplash.com/photo-1545665277-5937489579f2?w=200&q=80",
    x: "82%",
    y: "48%",
    rotate: -8,
    size: "w-24",
  },
  {
    src: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=200&q=80",
    x: "76%",
    y: "75%",
    rotate: 14,
    size: "w-28",
  },
  {
    src: "https://images.unsplash.com/photo-1535016120720-40c646be5580?w=200&q=80",
    x: "88%",
    y: "25%",
    rotate: -15,
    size: "w-20",
  },
  {
    src: "https://images.unsplash.com/photo-1626544827763-d516dce335e2?w=200&q=80",
    x: "85%",
    y: "65%",
    rotate: 6,
    size: "w-22",
  },
];

interface IPHeroProps {
  search: string;
  onSearchChange: (v: string) => void;
  investmentCount: number;
  presaleCount: number;
}

export function IPHero({ search, onSearchChange, investmentCount, presaleCount }: IPHeroProps) {
  const t = useTranslations("ip");

  return (
    <div className="relative overflow-hidden border-b border-border bg-background">
      {/* Scattered cover images */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        {COVERS.map((cover, i) => (
          <div
            key={i}
            className={`absolute ${cover.size} overflow-hidden rounded-xl shadow-2xl shadow-black/20 transition-transform duration-700`}
            style={{
              left: cover.x,
              top: cover.y,
              transform: `rotate(${cover.rotate}deg)`,
            }}
          >
            <img src={cover.src} alt="" className="size-full object-cover" loading="lazy" />
          </div>
        ))}
        {/* Fade edges so covers don't compete with center content */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-background/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/60" />
      </div>

      {/* Center content */}
      <div className="relative z-10 mx-auto max-w-screen-2xl px-6 py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="mb-4 text-4xl font-black leading-tight text-foreground md:text-5xl lg:text-6xl">
            {t("heroTitle1")}
            <br />
            <span className="relative">
              <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                {t("heroTitle2")}
              </span>
              <span className="absolute -bottom-1 left-0 h-1 w-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 opacity-30" />
            </span>
          </h1>
          <p className="mx-auto mb-8 max-w-lg text-sm leading-relaxed text-muted-foreground md:text-base">
            {t("heroDesc")}
          </p>

          {/* CTA buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="/ips/create"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
            >
              <IconSparkles className="size-4" />
              {t("createIP")}
            </a>
            <button
              type="button"
              onClick={() => {
                document.getElementById("ip-grid")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              <IconSearch className="size-4" />
              {t("browseIPs")}
            </button>
          </div>

          {/* Stats */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">{investmentCount}</strong> {t("ipsFundraising")}
            </span>
            <span className="text-border">·</span>
            <span>
              <strong className="text-foreground">{presaleCount}</strong> {t("ipsPresale")}
            </span>
            <span className="text-border">·</span>
            <span>
              {t("newThisWeek")} <strong className="text-foreground">5</strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
