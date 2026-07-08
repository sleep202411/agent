"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Status = "synced" | "connecting" | "offline";

/**
 * Wi-Fi-style realtime signal: four rising bars whose lit count + color reflect
 * the collab connection's health — blue (excellent) / green (good) / amber (fair)
 * / red (poor) / gray (offline). Driven by the connection status and the ping
 * round-trip (`rtt`). Always visible, so a bad reading tells the user it's their
 * own network, not the app. Hover shows the actual latency.
 */
export function ConnectionSignal({
  status,
  rtt,
  className,
}: {
  status: Status;
  rtt: number | null;
  className?: string;
}) {
  const t = useTranslations("canvasCollab");
  const { bars, color, title } = signal(status, rtt, t);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={title} className={cn("flex items-end gap-[3px]", className)}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "w-[3px] rounded-full transition-colors",
                i < bars ? color : "bg-white/20"
              )}
              style={{ height: `${6 + i * 3}px` }}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function signal(
  status: Status,
  rtt: number | null,
  t: ReturnType<typeof useTranslations<"canvasCollab">>
): { bars: number; color: string; title: string } {
  if (status === "offline")
    return { bars: 0, color: "bg-white/20", title: t("connection.offline") };
  if (status === "connecting")
    return { bars: 1, color: "animate-pulse bg-white/50", title: t("connection.connecting") };
  // synced
  if (rtt == null) return { bars: 3, color: "bg-emerald-400", title: t("connection.connected") };
  const ms = `${Math.round(rtt)}ms`;
  if (rtt < 80)
    return { bars: 4, color: "bg-sky-400", title: t("connection.latencyExcellent", { ms }) };
  if (rtt < 150)
    return { bars: 3, color: "bg-emerald-400", title: t("connection.latencyGood", { ms }) };
  if (rtt < 300)
    return { bars: 2, color: "bg-amber-400", title: t("connection.latencyFair", { ms }) };
  return { bars: 1, color: "bg-red-400", title: t("connection.latencyPoor", { ms }) };
}
