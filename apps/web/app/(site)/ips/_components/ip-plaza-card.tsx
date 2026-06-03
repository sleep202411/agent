"use client";

import Link from "next/link";
import { IconPlayerPlay, IconSparkles } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { UserAvatar, resolveUserAvatarUrl } from "@/components/user-avatar";
import type { LookupUserDTO } from "@repo/shared/users";
import type { PlazaProject } from "./plaza-types";

export function IPPlazaCard({
  project,
  ownerDisplay,
}: {
  project: PlazaProject;
  ownerDisplay?: LookupUserDTO;
}) {
  const t = useTranslations("ip");
  const locale = useLocale() as Locale;
  const cat = project.genres[0] ?? "";
  // The primary genre already shows as the image overlay (`cat`); drop it from
  // the badge row so single-genre IPs don't render the same label twice.
  const tags = project.tags.filter((tag) => tag !== cat).slice(0, 3);
  const ownerName =
    ownerDisplay?.nickname?.trim() || project.ownerName.trim() || t("anonymousOwner");

  return (
    <Link
      href={localizePath(`/ips/${project.id}`, locale)}
      className="group mb-6 inline-block w-full break-inside-avoid overflow-hidden rounded-2xl hover:bg-muted/90 align-top transition-all hover:shadow-lg hover:shadow-black/20"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-secondary">
        {project.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.cover}
            alt={project.name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105 rounded-2xl overflow-hidden"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconSparkles className="size-8 text-muted-foreground/20" />
          </div>
        )}

        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/15 to-transparent" />

        {project.trailer && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            <IconPlayerPlay className="size-3" />
            {t("trailer")}
          </span>
        )}

        <div className="absolute inset-x-3 bottom-2.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white transition-colors group-hover:text-primary">
            {project.name}
          </h3>
          {cat && <div className="mt-0.5 text-[10px] font-medium text-white/60">{cat}</div>}
        </div>
      </div>

      <div className="space-y-3.5 p-4">
        {project.description && (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs">
          <UserAvatar
            src={resolveUserAvatarUrl(ownerDisplay?.avatar ?? project.ownerAvatar)}
            seed={project.ownerId || project.id}
            name={ownerName}
            className="size-6 shrink-0"
          />
          <span className="truncate font-medium text-foreground">{ownerName}</span>
        </div>
      </div>
    </Link>
  );
}
