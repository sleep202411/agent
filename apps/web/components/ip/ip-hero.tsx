import { Link } from "@tanstack/react-router";
import { IconSparkles, IconBolt, IconMovie, IconTrendingUp, IconSearch } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";

interface IPHeroProps {
  search: string;
  onSearchChange: (v: string) => void;
  investmentCount: number;
  presaleCount: number;
}

export function IPHero({ search, onSearchChange, investmentCount, presaleCount }: IPHeroProps) {
  const t = useTranslations("ip");

  return (
    <div className="relative overflow-hidden border-b border-border">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 50%, hsl(42 95% 55% / 0.08) 0%, transparent 55%), radial-gradient(circle at 85% 20%, hsl(0 85% 52% / 0.06) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto max-w-screen-2xl px-6 pb-8 pt-10">
        <div className="mb-8 flex flex-col justify-between gap-6 md:flex-row md:items-start">
          <div className="max-w-xl">
            <div className="mb-3 flex items-center gap-2">
              <IconSparkles className="size-4 text-accent" />
              <span className="text-xs font-semibold uppercase tracking-widest text-accent">
                {t("plaza")}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{t("subtitle")}</span>
            </div>
            <h1 className="mb-3 text-3xl font-black leading-tight text-foreground md:text-4xl">
              {t("heroTitle1")}
              <br />
              <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                {t("heroTitle2")}
              </span>
            </h1>
            <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t("heroDesc")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="size-1.5 animate-pulse rounded-full bg-amber-400" />
                <span>
                  <strong className="text-foreground">{investmentCount}</strong>{" "}
                  {t("ipsFundraising")}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="size-1.5 animate-pulse rounded-full bg-blue-400" />
                <span>
                  <strong className="text-foreground">{presaleCount}</strong> {t("ipsPresale")}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconTrendingUp className="size-3 text-primary" />
                <span>
                  {t("newThisWeek")} <strong className="text-foreground">5</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/ips/create"
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/20 transition-colors hover:bg-accent/90"
            >
              <IconBolt className="size-4" /> {t("createIP")}
            </a>
            <Link
              to="/projects"
              className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80"
            >
              <IconMovie className="size-4" /> {t("enterStudio")}
            </Link>
          </div>
        </div>

        <div className="relative max-w-2xl">
          <IconSearch className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-xl border border-border bg-secondary py-3 pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground transition-all focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>
    </div>
  );
}
