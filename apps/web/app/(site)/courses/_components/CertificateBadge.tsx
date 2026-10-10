"use client";

import { useState } from "react";
import { IconAward } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export type CertificateBadgeSize = "sm" | "md" | "lg";

export function CertificateBadge({
  name,
  iconUrl,
  size = "sm",
  className,
}: {
  name: string;
  iconUrl: string;
  size?: CertificateBadgeSize;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(iconUrl) && failedUrl !== iconUrl;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-visible",
        size === "lg" && "size-12",
        size === "md" && "size-9",
        size === "sm" && "size-7",
        className
      )}
      title={name}
      aria-label={name}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={iconUrl}
          alt={name}
          className="size-full object-contain"
          onError={() => setFailedUrl(iconUrl)}
        />
      ) : (
        <IconAward
          className={cn(
            "text-[#d4b06a]",
            size === "lg" ? "size-8" : size === "md" ? "size-5" : "size-4"
          )}
        />
      )}
    </span>
  );
}
