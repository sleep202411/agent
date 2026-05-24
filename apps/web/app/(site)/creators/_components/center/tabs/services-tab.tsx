"use client";

/**
 * ServicesTab — real implementation backed by `/aurora/creator-services`.
 *
 * Owner view:
 *   - "+ 新建服务包" CTA opens the create dialog.
 *   - Lists every status (draft / listed / paused / archived) of own
 *     services. Each card carries inline manage actions (publish /
 *     pause / resume / edit / archive).
 *
 * Visitor view:
 *   - Only `listed` services. Cards link to a detail dialog
 *     (Phase 1b will land a dedicated /services/[id] route + order
 *     flow; for now the same dialog used by the owner reads the row
 *     in read-only mode).
 *
 * Empty state for owner keeps the Phase-1 marketing pitch above the
 * fold; visitor empty state is a plain "no services yet" message.
 */
import { useState } from "react";
import {
  IconArchive,
  IconBolt,
  IconClockHour4,
  IconEdit,
  IconLoader2,
  IconPalette,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSparkles,
  IconVideo,
  IconWorld,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  CREATOR_SERVICE_STATUSES,
  type CreatorServiceCardDTO,
  type CreatorServiceStatus,
} from "@repo/shared/creator-service";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useTranslations } from "@/src/i18n/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { env } from "@/src/env";
import { cn } from "@/lib/utils";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";
import {
  useArchiveService,
  useCreatorService,
  useCreatorServices,
  usePauseService,
  usePublishService,
  useResumeService,
} from "@/app/(site)/creators/_hooks/use-creator-services";
import { CreateServiceDialog } from "../dialogs/create-service-dialog";
import { ServiceDetailDialog } from "../dialogs/service-detail-dialog";

interface ServicesTabProps {
  creator: Creator;
  isOwner: boolean;
}

export function ServicesTab({ creator, isOwner }: ServicesTabProps) {
  const t = useTranslations("creatorService");
  const tCenter = useTranslations("creatorCenter");

  // Owner sees draft/paused/archived too; visitor only sees listed
  // (server enforces this — query.status is ignored unless viewer is
  // the creator).
  const [statusFilter, setStatusFilter] = useState<"all" | CreatorServiceStatus>(
    isOwner ? "all" : "listed"
  );
  const effectiveStatus = isOwner ? (statusFilter === "all" ? undefined : statusFilter) : "listed";

  const list = useCreatorServices({
    creatorId: creator.id,
    status: effectiveStatus,
  });

  const items = list.data?.items ?? [];

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingQuery = useCreatorService(editingId);
  // Archive confirmation — one AlertDialog instance for the whole
  // grid; the pending card id lives here so the dialog can call
  // archive on confirm.
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const archivingCard = items.find((s) => s.id === archivingId) ?? null;
  const archive = useArchiveService();
  // Visitor-side click-through: opens the read-only detail dialog.
  const [detailId, setDetailId] = useState<string | null>(null);

  // While loading the first page
  if (list.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {isOwner ? (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <OwnerStatusFilter value={statusFilter} onChange={setStatusFilter} />
          <Button type="button" variant="solid" color="primary" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-4" />
            {tCenter("cta.createService")}
          </Button>
        </header>
      ) : null}

      {items.length === 0 ? (
        isOwner ? (
          <OwnerEmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <VisitorEmptyState />
        )
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((s) => (
            <ServiceCard
              key={s.id}
              card={s}
              isOwner={isOwner}
              onEdit={() => setEditingId(s.id)}
              onRequestArchive={() => setArchivingId(s.id)}
              onOpenDetail={() => setDetailId(s.id)}
            />
          ))}
        </div>
      )}

      {list.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="ghost"
            color="muted"
            size="sm"
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {list.isFetchingNextPage ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("loadMore")}
          </Button>
        </div>
      ) : null}

      {/* Create dialog */}
      <CreateServiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => setCreateOpen(false)}
      />

      {/* Edit dialog — only mounts once detail loads, otherwise the
          form would flash empty fields. */}
      {editingId ? (
        <CreateServiceDialog
          open={!!editingQuery.data}
          onOpenChange={(o) => {
            if (!o) setEditingId(null);
          }}
          initial={editingQuery.data ?? null}
          onSaved={() => setEditingId(null)}
        />
      ) : null}

      {/* Visitor / owner-preview detail dialog. Read-only view of
          tier comparison + scope. Phase 1b "下单 / 联系" CTAs are
          stubbed inside the dialog. */}
      <ServiceDetailDialog
        serviceId={detailId}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      />

      {/* Archive confirmation — platform AlertDialog so the
          irreversible action carries explicit copy + matches the
          rest of the product's confirm style. */}
      <AlertDialog
        open={!!archivingId}
        onOpenChange={(o) => {
          if (!o && !archive.isPending) setArchivingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archiveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingCard
                ? t("archiveConfirmBody", { title: archivingCard.title })
                : t("archiveConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>{t("archiveCancel")}</AlertDialogCancel>
            <AlertDialogAction
              color="destructive"
              disabled={archive.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!archivingId) return;
                try {
                  await archive.mutateAsync(archivingId);
                  toast.success(t("archivedToast"));
                  setArchivingId(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t("archiveFailed"));
                }
              }}
            >
              {archive.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {t("archiveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────

function ServiceCard({
  card,
  isOwner,
  onEdit,
  onRequestArchive,
  onOpenDetail,
}: {
  card: CreatorServiceCardDTO;
  isOwner: boolean;
  onEdit: () => void;
  onRequestArchive: () => void;
  onOpenDetail: () => void;
}) {
  const t = useTranslations("creatorService");
  const detail = useCreatorService(isOwner ? card.id : null);
  const status = detail.data?.status;

  const publish = usePublishService();
  const pause = usePauseService();
  const resume = useResumeService();

  const cover = card.coverPath
    ? card.coverPath.startsWith("http")
      ? card.coverPath
      : `${env.BANNER_BASE_URL}/${card.coverPath}`
    : "";

  const handle = async (fn: () => Promise<unknown>, successKey: string, failureKey: string) => {
    try {
      await fn();
      toast.success(t(successKey));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t(failureKey));
    }
  };

  // Visitor: card body opens the detail dialog. Owner: clicks on
  // body do nothing (owner manages via the action row), so we skip
  // the cursor-pointer affordance.
  const bodyProps = isOwner
    ? {}
    : {
        role: "button" as const,
        tabIndex: 0,
        onClick: onOpenDetail,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenDetail();
          }
        },
      };

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl bg-card transition-transform hover:-translate-y-0.5">
      <div
        className={cn(
          "relative aspect-video w-full overflow-hidden bg-secondary",
          !isOwner && "cursor-pointer"
        )}
        {...bodyProps}
      >
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <CategoryFallback category={card.category} />
        )}
        <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-background/75 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur">
          {t(`category.${card.category}`)}
        </span>
        {isOwner && status ? <StatusBadge status={status} /> : null}
      </div>

      <div
        className={cn("flex flex-1 flex-col gap-3 p-4", !isOwner && "cursor-pointer")}
        {...bodyProps}
      >
        <header className="space-y-1">
          <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
            {card.title || "—"}
          </h3>
          <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
            {card.summary}
          </p>
        </header>

        {card.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {card.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {card.tags.length > 4 ? (
              <span className="inline-flex items-center text-[10px] text-muted-foreground">
                +{card.tags.length - 4}
              </span>
            ) : null}
          </div>
        ) : null}

        <footer className="mt-auto flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("cardStartingAt")}
            </span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {formatPrice(card.startingPrice, card.currency)}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            {card.startingDeliveryDays > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                <IconClockHour4 className="size-3" />
                {t("cardDeliveryFrom", {
                  days: String(card.startingDeliveryDays),
                })}
              </span>
            ) : null}
            {card.packageCount > 1 ? (
              <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("cardPackageCount", { count: String(card.packageCount) })}
              </span>
            ) : null}
          </div>
        </footer>

        {isOwner ? (
          <OwnerActions
            status={status}
            busy={publish.isPending || pause.isPending || resume.isPending}
            onEdit={onEdit}
            onPublish={() =>
              handle(() => publish.mutateAsync({ id: card.id }), "publishedToast", "publishFailed")
            }
            onPause={() =>
              handle(() => pause.mutateAsync({ id: card.id }), "pausedToast", "pauseFailed")
            }
            onResume={() =>
              handle(() => resume.mutateAsync({ id: card.id }), "resumedToast", "resumeFailed")
            }
            onArchive={onRequestArchive}
          />
        ) : null}
      </div>
    </article>
  );
}

function OwnerActions({
  status,
  busy,
  onEdit,
  onPublish,
  onPause,
  onResume,
  onArchive,
}: {
  status: CreatorServiceStatus | undefined;
  busy: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onPause: () => void;
  onResume: () => void;
  onArchive: () => void;
}) {
  // While the per-service detail row is still loading, we don't know
  // which transition is valid — render only the safe actions (edit,
  // archive).
  const archived = status === "archived";
  return (
    <div className="-mx-1 flex flex-wrap items-center gap-1 border-t border-background/60 pt-3">
      <ActionBtn
        icon={<IconEdit className="size-3.5" />}
        label="Edit"
        labelKey="actionEdit"
        onClick={onEdit}
        disabled={busy || archived}
      />
      {status === "draft" || status === "paused" ? (
        <ActionBtn
          icon={<IconPlayerPlay className="size-3.5" />}
          labelKey="actionPublish"
          onClick={onPublish}
          variant="primary"
          disabled={busy}
        />
      ) : null}
      {status === "listed" ? (
        <ActionBtn
          icon={<IconPlayerPause className="size-3.5" />}
          labelKey="actionPause"
          onClick={onPause}
          disabled={busy}
        />
      ) : null}
      {status === "paused" ? (
        <ActionBtn
          icon={<IconPlayerPlay className="size-3.5" />}
          labelKey="actionResume"
          onClick={onResume}
          variant="primary"
          disabled={busy}
        />
      ) : null}
      {!archived ? (
        <ActionBtn
          icon={<IconArchive className="size-3.5" />}
          labelKey="actionArchive"
          onClick={onArchive}
          variant="danger"
          disabled={busy}
        />
      ) : null}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  labelKey,
  onClick,
  disabled,
  variant = "ghost",
}: {
  icon: React.ReactNode;
  label?: string;
  labelKey: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "danger";
}) {
  const t = useTranslations("creatorService");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "text-primary hover:bg-primary/10",
        variant === "danger" && "text-destructive hover:bg-destructive/10",
        variant === "ghost" && "text-muted-foreground hover:bg-secondary"
      )}
    >
      {icon}
      {t(labelKey, { defaultValue: label ?? labelKey })}
    </button>
  );
}

function StatusBadge({ status }: { status: CreatorServiceStatus }) {
  const t = useTranslations("creatorService");
  const tone =
    status === "listed"
      ? "bg-emerald-500/90 text-white"
      : status === "draft"
        ? "bg-amber-500/90 text-white"
        : status === "paused"
          ? "bg-zinc-500/90 text-white"
          : "bg-zinc-700/90 text-zinc-200";
  return (
    <span
      className={cn(
        "absolute left-3 top-3 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-sm backdrop-blur",
        tone
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function OwnerStatusFilter({
  value,
  onChange,
}: {
  value: "all" | CreatorServiceStatus;
  onChange: (next: "all" | CreatorServiceStatus) => void;
}) {
  const t = useTranslations("creatorService");
  const options: ("all" | CreatorServiceStatus)[] = ["all", ...CREATOR_SERVICE_STATUSES];
  // No counts here: the card payload doesn't carry status, and per-
  // status counts would need a dedicated `/count-by-status` endpoint.
  // Fake counts (always 0) were doing more harm than good, so the
  // chips render as plain filter pills until the endpoint lands.
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-secondary p-1">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`filter.${opt}`)}
          </button>
        );
      })}
    </div>
  );
}

function CategoryFallback({ category }: { category: string }) {
  // Pick an icon by category family so empty covers don't all look
  // identical. Pure visual — no behavior change.
  const Icon =
    category === "video_production"
      ? IconVideo
      : category === "art_illustration" ||
          category === "character_design" ||
          category === "scene_design" ||
          category === "storyboard"
        ? IconPalette
        : category === "editing_post"
          ? IconBolt
          : IconWorld;
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground/70">
      <Icon className="size-10" strokeWidth={1.2} />
    </div>
  );
}

function OwnerEmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations("creatorService");
  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-card to-card">
      <div className="flex flex-col gap-5 px-6 py-8 md:flex-row md:items-center md:gap-8 md:px-8">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <IconSparkles className="size-6" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground md:text-xl">
            {t("ownerEmptyTitle")}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("ownerEmptyBody")}</p>
        </div>
        <Button
          type="button"
          variant="solid"
          color="primary"
          className="shrink-0"
          onClick={onCreate}
        >
          <IconPlus className="size-4" />
          {t("ownerEmptyCta")}
        </Button>
      </div>
    </div>
  );
}

function VisitorEmptyState() {
  const t = useTranslations("creatorService");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <IconClockHour4 className="size-5" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">{t("visitorEmptyTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("visitorEmptyBody")}</p>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

function formatPrice(amount: number, currency: string): string {
  const isZero = ZERO_DECIMAL_CURRENCIES.has(
    currency as Parameters<typeof ZERO_DECIMAL_CURRENCIES.has>[0]
  );
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: isZero ? 0 : 0,
    maximumFractionDigits: isZero ? 0 : 2,
  }).format(amount);
}
