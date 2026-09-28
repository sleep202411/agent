import type { IpPublisherPublic } from "@/src/lib/ip-commerce/api";
import { cn } from "@/lib/utils";

/**
 * Compact logo strip for admin-curated distribution partners.
 *
 * Brand marks are usually horizontal wordmarks (Netflix / 优酷 / 芒果), not
 * circular avatars — keep a fixed-height rectangular chip so plaza cards stay
 * even when logos are present.
 */
export function IpPublisherLogos({
  publishers,
  label,
  size = "md",
  className,
}: {
  publishers: IpPublisherPublic[] | undefined | null;
  /** Visible section label (i18n). */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const items = (publishers ?? []).filter((row) => row.logoUrl?.trim()).slice(0, 4);
  if (items.length === 0) return null;

  // Fixed outer height + object-contain so wordmarks stay legible without
  // wrapping into a second row (which would stretch plaza card heights).
  const chip =
    size === "sm"
      ? "h-5 w-12 rounded-md"
      : size === "lg"
        ? "h-9 w-[5.5rem] rounded-lg"
        : "h-6 w-14 rounded-md";
  const rowH = size === "sm" ? "h-5" : size === "lg" ? "h-9" : "h-6";
  const gap = size === "lg" ? "gap-2.5" : "gap-1.5";

  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      ) : null}
      <ul className={cn("flex flex-nowrap items-center overflow-hidden", gap, rowH)} role="list">
        {items.map((publisher) => {
          const content = (
            // eslint-disable-next-line @next/next/no-img-element -- remote/OSS logos; next/image domains not enumerated
            <img
              src={publisher.logoUrl}
              alt={publisher.name}
              title={publisher.name}
              loading="lazy"
              className={cn(
                "bg-white/90 object-contain p-0.5 opacity-95 transition-opacity hover:opacity-100 dark:bg-white/10",
                chip
              )}
            />
          );
          return (
            <li key={publisher.id} className="shrink-0">
              {publisher.websiteUrl ? (
                <a
                  href={publisher.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={publisher.name}
                  className="inline-flex"
                  onClick={(event) => event.stopPropagation()}
                >
                  {content}
                </a>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
