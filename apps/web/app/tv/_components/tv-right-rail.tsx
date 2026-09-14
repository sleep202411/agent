"use client";

import { useState } from "react";
import { IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { TvComments } from "./tv-comments";
import { ViewerAssistance } from "./viewer-assistance";

type Panel = "comments" | "assistance";

export function TvRightRail({ ipId }: { ipId: string | null }) {
  const t = useTranslations("tv");
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(ipId ? "comments" : "assistance");
  const [ipEpoch, setIpEpoch] = useState(ipId);

  if (ipEpoch !== ipId) {
    setIpEpoch(ipId);
    setPanel(ipId ? "comments" : "assistance");
  }

  const toggleClass =
    "flex size-9 shrink-0 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  const railToggle = (
    <button
      type="button"
      aria-label={t("collapseRail")}
      aria-expanded
      onClick={() => setCollapsed(true)}
      className={toggleClass}
    >
      <IconLayoutSidebarRightCollapse className="size-[18px]" />
    </button>
  );

  return (
    <aside
      className={cn(
        "flex w-full shrink-0 flex-col border-t border-white/10 md:h-full md:overflow-hidden md:border-l md:border-t-0",
        collapsed ? "md:w-[72px]" : "md:w-72 xl:w-80"
      )}
    >
      {collapsed ? (
        <div className="flex h-11 shrink-0 items-center justify-center border-b border-white/10 md:h-full md:border-b-0">
          <button
            type="button"
            aria-label={t("expandRail")}
            aria-expanded={false}
            onClick={() => setCollapsed(false)}
            className={toggleClass}
          >
            <IconLayoutSidebarRightExpand className="size-[18px]" />
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {ipId ? (
            <TvComments
              ipId={ipId}
              open={panel === "comments"}
              onOpenChange={(next) => setPanel(next ? "comments" : null)}
              railToggle={railToggle}
            />
          ) : null}
          <ViewerAssistance
            open={panel === "assistance"}
            onOpenChange={(next) => setPanel(next ? "assistance" : null)}
            railToggle={ipId ? undefined : railToggle}
          />
        </div>
      )}
    </aside>
  );
}
