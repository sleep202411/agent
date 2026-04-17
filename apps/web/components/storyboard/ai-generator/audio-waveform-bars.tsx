"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface AudioWaveformBarsProps {
  audioKey?: string;
  progress?: number;
  loading?: boolean;
  count?: number;
  className?: string;
}

export function AudioWaveformBars({
  audioKey = "",
  progress = 0,
  loading = false,
  count = 50,
  className,
}: AudioWaveformBarsProps) {
  const bars = useMemo(() => {
    if (loading) {
      return new Array(count).fill(0);
    }

    let hash = 0;
    for (let index = 0; index < audioKey.length; index += 1) {
      hash = ((hash << 5) - hash + audioKey.charCodeAt(index)) | 0;
    }

    const result: number[] = [];
    for (let index = 0; index < count; index += 1) {
      hash = (hash * 1103515245 + 12345) & 0x7fffffff;
      result.push(20 + (hash % 71));
    }
    return result;
  }, [audioKey, count, loading]);

  return (
    <div className={cn("flex h-8 min-h-8 w-full min-w-0 items-center gap-[1.5px]", className)}>
      {bars.map((height, index) => {
        const played = progress > 0 && index < progress * bars.length;
        return (
          <span
            key={`${audioKey || "wave"}_${index}`}
            className={cn(
              "min-w-[1px] flex-1 rounded-[1px]",
              loading ? "animate-pulse bg-white/[0.08]" : played ? "bg-[#E52227]" : "bg-white/25"
            )}
            style={
              loading
                ? {
                    height: `${20 + ((index * 17) % 50)}%`,
                    animationDelay: `${index * 0.06}s`,
                  }
                : {
                    height: `${height}%`,
                  }
            }
          />
        );
      })}
    </div>
  );
}
