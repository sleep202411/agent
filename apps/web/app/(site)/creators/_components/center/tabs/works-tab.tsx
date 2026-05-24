"use client";

/**
 * WorksTab — personal video works grid. Reads `useCreatorPersonalWorks`
 * for both visitor and owner views (the backend list returns the same
 * shape regardless of viewer; owner just sees a "publish" CTA on top
 * because they can act on it).
 */
import { useState } from "react";
import Link from "next/link";
import { IconLoader2, IconPlayerPlay, IconPlus, IconVideo } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { env } from "@/src/env";
import { useCreatorPersonalWorks, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { PersonalWork } from "@/src/services/project";
import { WorkPlayDialog } from "../dialogs/work-play-dialog";

interface WorksTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function WorksTab({ creator, isOwner }: WorksTabProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  const publishHref = localizePath("/publish", locale);
  const { data, isLoading } = useCreatorPersonalWorks(creator.id, isOwner);
  const works = (data ?? []).filter((w): w is PersonalWork => !!w);

  // Single shared dialog driven by which card was clicked. Lifted to
  // the tab so opening a card doesn't have to remount the dialog every
  // time and the signed-URL fetch resets cleanly between clicks.
  const [activeWork, setActiveWork] = useState<PersonalWork | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (works.length === 0) {
    return (
      <EmptyShell
        title={isOwner ? t("works.emptyOwnerTitle") : t("works.emptyVisitorTitle")}
        body={isOwner ? t("works.emptyOwnerBody") : t("works.emptyVisitorBody")}
        action={
          isOwner ? (
            <Button type="button" variant="outline" color="muted" asChild>
              <Link href={publishHref}>
                <IconPlus className="size-4" />
                {t("works.publishCta")}
              </Link>
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <>
      {isOwner ? (
        <div className="mb-4 flex justify-end">
          <Button type="button" variant="outline" color="muted" size="sm" asChild>
            <Link href={publishHref}>
              <IconPlus className="size-3.5" />
              {t("works.publishCta")}
            </Link>
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {works.map((w, i) => (
          <WorkCard
            key={String(w.id ?? w.videoLink ?? `idx-${i}`)}
            work={w}
            onClick={() => setActiveWork(w)}
          />
        ))}
      </div>
      <WorkPlayDialog
        open={!!activeWork}
        onOpenChange={(open) => {
          if (!open) setActiveWork(null);
        }}
        work={activeWork}
      />
    </>
  );
}

function WorkCard({ work, onClick }: { work: PersonalWork; onClick: () => void }) {
  // `videoBanner` is an OSS-relative key (e.g. `2259/personal/<uuid>.jpg`)
  // and lives on the BANNER bucket — same convention as IP covers, NOT
  // the STATIC bucket (which is for default backgrounds / fallbacks).
  // Mirrors the legacy `IMG_BASE_URL` used by mine.vue/portfolioPC.vue.
  const cover = resolveAsset(String(work.videoBanner ?? ""), env.BANNER_BASE_URL);
  const title = String(work.title ?? "").trim() || "—";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-xl bg-card text-left transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-secondary">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <IconVideo className="size-6" />
          </div>
        )}
        {/* Play affordance — only meaningful when a video is attached;
            banner-only records still get the same overlay since the
            modal handles the no-video fallback gracefully. */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
          <div className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            <IconPlayerPlay className="size-5" />
          </div>
        </div>
      </div>
      <div className="px-3 py-2.5">
        <h3 className="line-clamp-1 text-sm font-medium text-foreground">{title}</h3>
      </div>
    </button>
  );
}

function EmptyShell({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <IconVideo className="size-5" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

function resolveAsset(path: string, base: string): string {
  if (!path) return "";
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (!base) return "";
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `${base.replace(/\/+$/, "")}/${trimmed}`;
}
