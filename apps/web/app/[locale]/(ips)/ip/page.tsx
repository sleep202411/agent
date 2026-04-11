import { useMemo, useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { FUNDING_STAGES, MOCK_IPS } from "@/components/ip/ip-mock";
import { IPCard } from "@/components/ip/ip-card";
import { IPHero } from "@/components/ip/ip-hero";
import { IPSidebar } from "@/components/ip/ip-sidebar";

export default function IPPlazaPage() {
  const t = useTranslations("ip");
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return MOCK_IPS.filter((ip) => {
      const matchStage = stageFilter === "all" || ip.stage === stageFilter;
      const matchSearch =
        !search ||
        ip.title.toLowerCase().includes(search.toLowerCase()) ||
        ip.desc.toLowerCase().includes(search.toLowerCase()) ||
        ip.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
      return matchStage && matchSearch;
    });
  }, [stageFilter, search]);

  const investmentCount = MOCK_IPS.filter((i) => i.stage === "investment").length;
  const presaleCount = MOCK_IPS.filter((i) => i.stage === "presale").length;

  return (
    <div className="min-h-screen bg-background">
      <IPHero
        search={search}
        onSearchChange={setSearch}
        investmentCount={investmentCount}
        presaleCount={presaleCount}
      />

      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="flex gap-6">
          {/* Main content */}
          <div className="min-w-0 flex-1">
            {/* Stage filter */}
            <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {FUNDING_STAGES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStageFilter(s.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition-all",
                    stageFilter === s.value
                      ? "border-primary/40 bg-card text-foreground shadow"
                      : "border-border bg-secondary text-muted-foreground hover:border-border/80 hover:text-foreground"
                  )}
                >
                  <div>{t(s.labelKey)}</div>
                  {"descKey" in s && s.descKey && (
                    <div
                      className={cn(
                        "mt-0.5 text-xs font-normal",
                        stageFilter === s.value
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60"
                      )}
                    >
                      {t(s.descKey)}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Count */}
            <div className="mb-4">
              <span className="text-xs text-muted-foreground">
                {t("total")}{" "}
                <span className="font-semibold text-foreground">{filtered.length}</span> {t("ips")}
              </span>
            </div>

            {/* Grid */}
            {filtered.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((ip) => (
                  <IPCard key={ip.id} ip={ip} />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center text-muted-foreground">
                <IconSparkles className="mx-auto mb-3 size-10 opacity-30" />
                <p className="text-sm">{t("noResults")}</p>
                <button
                  type="button"
                  onClick={() => {
                    setStageFilter("all");
                    setSearch("");
                  }}
                  className="mt-3 text-xs text-primary hover:underline"
                >
                  {t("clearFilters")}
                </button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <IPSidebar ips={MOCK_IPS} />
        </div>
      </div>
    </div>
  );
}
