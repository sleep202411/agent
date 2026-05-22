"use client";

/**
 * WorksTab — personal video works grid. Reads `useCreatorPersonalWorks`
 * for both visitor and owner views (the backend list returns the same
 * shape regardless of viewer; owner just sees a "publish" CTA on top
 * because they can act on it).
 */
import { IconLoader2, IconPlus, IconVideo } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import { env } from "@/src/env";
import { useCreatorPersonalWorks, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import type { PersonalWork } from "@/src/services/project";

interface WorksTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function WorksTab({ creator, isOwner }: WorksTabProps) {
  const t = useTranslations("creatorCenter");
  const { data, isLoading } = useCreatorPersonalWorks(creator.id);
  const works = (data ?? []).filter((w): w is PersonalWork => !!w);

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
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => toast.info(t("ctaWorksEdit"))}
            >
              <IconPlus className="size-4" />
              {t("works.publishCta")}
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
          <Button
            type="button"
            variant="outline"
            color="muted"
            size="sm"
            onClick={() => toast.info(t("ctaWorksEdit"))}
          >
            <IconPlus className="size-3.5" />
            {t("works.publishCta")}
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {works.map((w, i) => (
          <WorkCard key={String(w.id ?? w.videoLink ?? `idx-${i}`)} work={w} />
        ))}
      </div>
    </>
  );
}

function WorkCard({ work }: { work: PersonalWork }) {
  // Personal-work cover paths come back relative to the static CDN
  // (same convention as the creators talent grid uses).
  const cover = resolveAsset(String(work.videoBanner ?? ""), env.STATIC_BASE_URL);
  const title = String(work.title ?? "").trim() || "—";
  return (
    <div className="group overflow-hidden rounded-xl bg-card">
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
      </div>
      <div className="px-3 py-2.5">
        <h3 className="line-clamp-1 text-sm font-medium text-foreground">{title}</h3>
      </div>
    </div>
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
