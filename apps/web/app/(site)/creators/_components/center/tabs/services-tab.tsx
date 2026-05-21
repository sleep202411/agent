"use client";

/**
 * ServicesTab — the commercial entry tab. Default-selected on the
 * creator center.
 *
 * Phase 1a backend (`/aurora/creator-services`) is not yet built, so
 * this tab is intentionally stub-rendered today:
 *
 *   - Owner sees an empty-state with a "+ 新建服务包" CTA that toasts
 *     "this is the next thing we're shipping".
 *   - Visitor sees a "this creator hasn't published a service yet"
 *     placeholder.
 *
 * When the backend lands the only change here is `services = [...]`
 * fetched via `useCreatorServices(creator.id)` and a card grid
 * rendered with package selector + price chip + 下单 button.
 */
import {
  IconBolt,
  IconPackage,
  IconPalette,
  IconPlus,
  IconSparkles,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

interface ServicesTabProps {
  creator: Creator;
  isOwner: boolean;
}

// Three ghost-card categories to hint at what published services will
// look like. Pure preview — no click handlers, no data.
const PREVIEW_CATEGORIES = [
  {
    id: "video",
    icon: IconVideo,
    titleKey: "services.previewVideoTitle",
    bodyKey: "services.previewVideoBody",
    accent: "from-rose-500/30 via-rose-500/10",
  },
  {
    id: "art",
    icon: IconPalette,
    titleKey: "services.previewArtTitle",
    bodyKey: "services.previewArtBody",
    accent: "from-indigo-500/30 via-indigo-500/10",
  },
  {
    id: "quick",
    icon: IconBolt,
    titleKey: "services.previewQuickTitle",
    bodyKey: "services.previewQuickBody",
    accent: "from-amber-500/30 via-amber-500/10",
  },
] as const;

export function ServicesTab({ creator: _creator, isOwner }: ServicesTabProps) {
  const t = useTranslations("creatorCenter");

  // Phase 1a — no real services yet.
  const services: never[] = [];

  if (services.length === 0) {
    return (
      <div className="space-y-6">
        {/* Hero — explains what the tab is, anchors the CTA. */}
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-card to-card">
          <div className="flex flex-col gap-5 px-6 py-7 md:flex-row md:items-center md:gap-8 md:px-8 md:py-9">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <IconSparkles className="size-6" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <h2 className="text-lg font-semibold text-foreground md:text-xl">
                {isOwner ? t("services.emptyOwnerTitle") : t("services.emptyVisitorTitle")}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {isOwner ? t("services.emptyOwnerBody") : t("services.emptyVisitorBody")}
              </p>
            </div>
            {isOwner ? (
              <Button
                type="button"
                variant="solid"
                color="primary"
                className="shrink-0"
                onClick={() => toast.info(t("ctaPhase1aHint"))}
              >
                <IconPlus className="size-4" />
                {t("cta.createService")}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Ghost preview row — gives the tab visual structure when empty. */}
        <div>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("services.previewHeading")}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PREVIEW_CATEGORIES.map((c) => (
              <PreviewCard
                key={c.id}
                icon={<c.icon className="size-5" strokeWidth={1.5} />}
                accent={c.accent}
                title={t(c.titleKey)}
                body={t(c.bodyKey)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Future render path — kept here so reviewers see the intended shape.
  // Each card carries the doc § 6.2 fields: title, summary, package
  // selector, base price, delivery days, revisions, "Start request" CTA.
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {services.map(() => (
        <div key={undefined} className="rounded-xl border border-border bg-card p-4">
          <IconPackage className="size-5" />
        </div>
      ))}
    </div>
  );
}

function PreviewCard({
  icon,
  accent,
  title,
  body,
}: {
  icon: React.ReactNode;
  accent: string;
  title: string;
  body: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl bg-card/70 p-4 transition-colors">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent} to-transparent opacity-50`}
      />
      <div className="relative space-y-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-background/60 text-foreground/80 backdrop-blur">
          {icon}
        </div>
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
