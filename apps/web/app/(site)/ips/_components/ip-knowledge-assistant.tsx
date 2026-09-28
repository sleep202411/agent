"use client";

import { useState } from "react";
import { IconSparkles, IconX } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import { IpKnowledgeChat } from "./ip-knowledge-chat";

export function IpKnowledgeAssistant({ ipId, ipTitle }: { ipId: string; ipTitle: string }) {
  const t = useTranslations("ipKnowledge");
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("launcher")}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <IconSparkles className="size-5" aria-hidden="true" />
          {t("launcher")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        aria-label={t("launcher")}
        className="max-h-[min(70dvh,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted-foreground" title={ipTitle}>
            {ipTitle}
          </p>
          <button
            type="button"
            aria-label={t("close")}
            onClick={() => setOpen(false)}
            className="shrink-0 rounded-full p-2 hover:bg-accent"
          >
            <IconX className="size-4" aria-hidden="true" />
          </button>
        </div>
        <IpKnowledgeChat key={`${ipId}:${user?.id ?? "guest"}`} ipId={ipId} />
      </PopoverContent>
    </Popover>
  );
}
