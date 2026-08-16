"use client";

import { useState } from "react";
import Image from "next/image";
import { IconFileDescription } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export function SkillPreviewImage({
  src,
  alt,
  sizes,
  className,
  fallbackIconClassName,
}: {
  src: string | null | undefined;
  alt: string;
  sizes: string;
  className?: string;
  fallbackIconClassName?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src && failedSrc === src);
  // Protected media is served through the same-origin Aurora proxy. Let the
  // browser request it directly so the user's session cookie is preserved;
  // Next's server-side image optimizer cannot authenticate that request.
  const isProtectedMedia = Boolean(src?.startsWith("/aurora/media/assets/"));

  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className="absolute inset-0 grid place-items-center text-white/22"
      >
        <IconFileDescription className={cn("size-7", fallbackIconClassName)} stroke={1.3} />
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized={isProtectedMedia}
      loading="eager"
      sizes={sizes}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}
