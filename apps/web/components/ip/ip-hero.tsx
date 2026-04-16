import { IconSearch, IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

// Scattered cover images — large, edge-hugging, partially offscreen
const COVERS = [
  // Left side
  {
    src: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=400&q=80",
    x: "-3%",
    y: "3%",
    rotate: -8,
    w: 180,
    h: 250,
  },
  {
    src: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=400&q=80",
    x: "-2%",
    y: "52%",
    rotate: 10,
    w: 160,
    h: 220,
  },
  {
    src: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=80",
    x: "5%",
    y: "78%",
    rotate: -5,
    w: 150,
    h: 200,
  },
  {
    src: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&q=80",
    x: "11%",
    y: "12%",
    rotate: 14,
    w: 140,
    h: 190,
  },
  {
    src: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=400&q=80",
    x: "14%",
    y: "42%",
    rotate: -16,
    w: 120,
    h: 170,
  },
  // Right side
  {
    src: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&q=80",
    x: "76%",
    y: "2%",
    rotate: 7,
    w: 175,
    h: 240,
  },
  {
    src: "https://images.unsplash.com/photo-1545665277-5937489579f2?w=400&q=80",
    x: "79%",
    y: "48%",
    rotate: -10,
    w: 160,
    h: 220,
  },
  {
    src: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400&q=80",
    x: "73%",
    y: "74%",
    rotate: 12,
    w: 155,
    h: 210,
  },
  {
    src: "https://images.unsplash.com/photo-1535016120720-40c646be5580?w=400&q=80",
    x: "86%",
    y: "18%",
    rotate: -13,
    w: 135,
    h: 185,
  },
  {
    src: "https://images.unsplash.com/photo-1626544827763-d516dce335e2?w=400&q=80",
    x: "88%",
    y: "62%",
    rotate: 5,
    w: 125,
    h: 175,
  },
];

// Bounce-in keyframes injected once
const BOUNCE_KEYFRAMES = `
@keyframes bounceCardIn {
  0% { opacity: 0; transform: scale(0) rotate(var(--card-rotate)); }
  50% { opacity: 1; transform: scale(1.15) rotate(var(--card-rotate)); }
  70% { transform: scale(0.92) rotate(var(--card-rotate)); }
  85% { transform: scale(1.05) rotate(var(--card-rotate)); }
  100% { opacity: 1; transform: scale(1) rotate(var(--card-rotate)); }
}
`;

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
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: BOUNCE_KEYFRAMES }} />

      {/* Scattered cover images with bounce-in */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        {COVERS.map((cover, i) => (
          <div
            key={i}
            className="absolute overflow-hidden rounded-2xl shadow-2xl shadow-black/30"
            style={
              {
                left: cover.x,
                top: cover.y,
                width: cover.w,
                height: cover.h,
                "--card-rotate": `${cover.rotate}deg`,
                opacity: 0,
                animation: `bounceCardIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
                animationDelay: `${0.3 + i * 0.08}s`,
              } as React.CSSProperties
            }
          >
            <img src={cover.src} alt="" className="size-full object-cover" loading="lazy" />
          </div>
        ))}
        {/* Radial fade from center */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 50% 50%, var(--color-background) 30%, transparent 80%)",
          }}
        />
      </div>

      {/* Center content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-screen-2xl items-center px-6">
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
