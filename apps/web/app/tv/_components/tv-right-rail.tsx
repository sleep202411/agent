"use client";

import { useState } from "react";
import { IconMessageCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { TvComments } from "./tv-comments";

export function TvRightRail({ ipId }: { ipId: string | null }) {
  const [open, setOpen] = useState(true);
  const t = useTranslations("tvComments");
  if (!ipId) return null;
  return (
    <aside
      className={`flex w-full shrink-0 flex-col border-t border-white/10 lg:h-full lg:overflow-hidden lg:border-l lg:border-t-0 ${open ? "lg:w-72 xl:w-80" : "lg:w-12"}`}
    >
      {!open && (
        <button
          type="button"
          aria-label={t("expand")}
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="flex min-h-11 items-center justify-center gap-2 rounded text-sm text-white/60 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
        >
          <IconMessageCircle aria-hidden className="size-5" />
          <span className="lg:hidden">{t("title")}</span>
        </button>
      )}
      <div className={open ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <TvComments key={ipId} ipId={ipId} open={open} onOpenChange={setOpen} />
      </div>
    </aside>
  );
}
