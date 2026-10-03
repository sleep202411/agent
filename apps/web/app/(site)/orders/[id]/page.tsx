"use client";

/**
 * /orders/[id] — order detail + embedded conversation.
 *
 * Layout (desktop): two columns.
 *   Left  — order summary (status, parties, package snapshot,
 *           questionnaire, bindings) + action buttons keyed off
 *           role × current state.
 *   Right — the order's conversation (re-uses ConversationView).
 *
 * Mobile: tabs (summary | chat).
 *
 * Action buttons gate themselves via `canTransition` from
 * @repo/shared/order so client + server agree on what's allowed.
 */
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { IconArrowLeft, IconLoader2 } from "@tabler/icons-react";
import { type OrderDTO, type OrderStatus } from "@repo/shared/order";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { Button } from "@/components/ui/button";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { cn } from "@/lib/utils";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { UserAvatar } from "@/components/user-avatar";
import { useOrder } from "@/app/(site)/creators/_hooks/use-orders";
import { ActionFooter } from "./action-footer";
import { ConversationView } from "@/app/(site)/messages/_components/conversation-view";

type Pane = "summary" | "chat";

export default function OrderDetailPage() {
  const t = useTranslations("orders");
  const locale = useLocale() as Locale;
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { user, isLoading: userLoading } = useCurrentUser();
  const { data: order, isLoading, isError, error, refetch, isFetching } = useOrder(id);
  const auth = useAuthDialog();
  const common = useTranslations("common");
  const [pane, setPane] = useState<Pane>("summary");
  const back = (
    <Link
      href={localizePath("/orders", locale)}
      className="inline-flex items-center gap-2 rounded-md text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft className="size-4" aria-hidden="true" />
      {t("list.back")}
    </Link>
  );
  const loading = userLoading || (!!user && isLoading);
  const unavailable = !order || (order.buyerId !== user?.id && order.creatorId !== user?.id);

  if (loading || !user || isError || unavailable) {
    return (
      <div className="mx-auto flex min-h-80 max-w-2xl flex-col gap-6 px-5 py-6">
        <div>{back}</div>
        <div className="space-y-4 py-8">
          {loading ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
              {common("loading")}
            </p>
          ) : !user ? (
            <>
              <p className="text-sm text-muted-foreground">{t("signInRequired")}</p>
              <Button size="sm" onClick={() => auth.open()}>
                {t("signIn")}
              </Button>
            </>
          ) : (
            <>
              <p role="alert" className="break-words text-sm text-muted-foreground">
                {isError ? error?.message || common("loadFailed") : t("unavailable")}
              </p>
              {isError && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {isFetching ? common("loading") : common("retry")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const role = order.buyerId === user.id ? "buyer" : "creator";

  return (
    <div className="grid h-[calc(100dvh-64px)] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground lg:grid-cols-[minmax(360px,520px)_1fr]">
      {/* Return navigation stays available at every width. */}
      <div className="flex shrink-0 items-center justify-center gap-1 border-b border-border px-5 py-3 lg:col-span-2">
        <div className="mr-auto">{back}</div>
        {(["summary", "chat"] as Pane[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPane(p)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors lg:hidden",
              pane === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {t(`pane.${p}`)}
          </button>
        ))}
      </div>

      {/* Left: summary */}
      <div
        className={cn(
          "min-h-0 border-r border-border lg:block",
          pane === "summary" ? "block" : "hidden"
        )}
      >
        <OrderSummary order={order} role={role} />
      </div>

      {/* Right: chat */}
      <div className={cn("min-w-0 lg:block", pane === "chat" ? "block" : "hidden")}>
        <ConversationView conversationId={order.conversationId} />
      </div>
    </div>
  );
}

// ─── Summary pane ───────────────────────────────────────────

function OrderSummary({ order, role }: { order: OrderDTO; role: "buyer" | "creator" }) {
  const t = useTranslations("orders");
  const counterpartyId = role === "buyer" ? order.creatorId : order.buyerId;
  const displays = useUserDisplays([counterpartyId]);
  const counterparty = displays.get(counterpartyId);

  const snap = order.packageSnapshot;
  const priceLabel = formatPrice(snap.price, snap.currency);

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-3 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <StatusBadge status={order.status} />
          <span className="text-[10px] text-muted-foreground">#{order.id}</span>
        </div>
        <div className="flex items-center gap-3">
          <UserAvatar
            src={counterparty?.avatar}
            name={counterparty?.nickname ?? ""}
            seed={counterpartyId}
            className="size-9"
          />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t(role === "buyer" ? "creatorLabel" : "buyerLabel")}
            </div>
            <div className="line-clamp-1 text-sm font-medium text-foreground">
              {counterparty?.nickname ?? `User ${counterpartyId}`}
            </div>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Package snapshot */}
        <section className="space-y-2">
          <SectionTitle>{t("packageSection")}</SectionTitle>
          <div className="rounded-xl bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`tier.${snap.tier}`)}
              </span>
              <span className="text-xl font-bold tabular-nums text-foreground">{priceLabel}</span>
            </div>
            {snap.title ? (
              <h3 className="mt-1 text-sm font-semibold text-foreground">{snap.title}</h3>
            ) : null}
            {snap.description ? (
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                {snap.description}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{t("nDays", { days: String(snap.deliveryDays) })}</span>
              <span>
                {snap.revisions === -1
                  ? t("revisionsUnlimited")
                  : t("revisionsCount", { count: String(snap.revisions) })}
              </span>
            </div>
            {snap.scope.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-foreground">
                {snap.scope.map((b, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/70" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        {/* Questionnaire */}
        {order.questionnaire.length > 0 ? (
          <section className="space-y-2">
            <SectionTitle>{t("questionnaireSection")}</SectionTitle>
            <div className="space-y-2">
              {order.questionnaire.map((q, i) => (
                <div key={i} className="rounded-lg bg-card/60 px-3 py-2.5">
                  <div className="text-[11px] text-muted-foreground">
                    {q.prompt}
                    {q.required ? <span className="ml-1 text-destructive">*</span> : null}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                    {q.answer || t("noAnswer")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* FD bindings */}
        {hasBindings(order) ? (
          <section className="space-y-2">
            <SectionTitle>{t("bindingsSection")}</SectionTitle>
            <BindingsList order={order} />
          </section>
        ) : null}

        {/* Timeline */}
        <section className="space-y-2">
          <SectionTitle>{t("timelineSection")}</SectionTitle>
          <TimelineList order={order} />
        </section>

        {order.cancelInfo ? (
          <section className="space-y-2">
            <SectionTitle>{t("cancelSection")}</SectionTitle>
            <div className="rounded-lg bg-card/60 px-3 py-2.5 text-xs">
              <p className="text-foreground">
                {t("cancelledBy", {
                  by: t(`role.${order.cancelInfo.by}`),
                })}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                {order.cancelInfo.reason}
              </p>
            </div>
          </section>
        ) : null}
      </div>

      <ActionFooter order={order} role={role} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function hasBindings(order: OrderDTO): boolean {
  return Object.values(order.bindings).some((v) => !!v);
}

function BindingsList({ order }: { order: OrderDTO }) {
  const t = useTranslations("orders");
  const entries: { key: keyof OrderDTO["bindings"]; label: string }[] = [
    { key: "ipId", label: t("binding.ip") },
    { key: "episodeId", label: t("binding.episode") },
    { key: "crewId", label: t("binding.crew") },
    { key: "crewPositionId", label: t("binding.crewPosition") },
  ];
  return (
    <div className="space-y-1.5 text-xs">
      {entries
        .filter((e) => !!order.bindings[e.key])
        .map((e) => (
          <div
            key={e.key}
            className="flex items-center justify-between gap-2 rounded-md bg-card/60 px-3 py-2"
          >
            <span className="text-muted-foreground">{e.label}</span>
            <span className="font-mono text-foreground">{String(order.bindings[e.key])}</span>
          </div>
        ))}
    </div>
  );
}

function TimelineList({ order }: { order: OrderDTO }) {
  const t = useTranslations("orders");
  const items: { at: string; label: string }[] = [];
  items.push({ at: order.createdAt, label: t("timeline.created") });
  if (order.acceptedAt) items.push({ at: order.acceptedAt, label: t("timeline.accepted") });
  if (order.deliveredAt) items.push({ at: order.deliveredAt, label: t("timeline.delivered") });
  if (order.completedAt) items.push({ at: order.completedAt, label: t("timeline.completed") });
  if (order.cancelledAt) items.push({ at: order.cancelledAt, label: t("timeline.cancelled") });
  return (
    <ol className="space-y-1.5 text-xs">
      {items.map((it, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between gap-3 rounded-md bg-card/60 px-3 py-2"
        >
          <span className="text-foreground">{it.label}</span>
          <span className="text-muted-foreground">{formatDate(it.at)}</span>
        </li>
      ))}
    </ol>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("orders");
  const tone =
    status === "in_progress"
      ? "bg-primary/15 text-primary"
      : status === "delivered"
        ? "bg-amber-500/20 text-amber-300"
        : status === "completed"
          ? "bg-emerald-500/20 text-emerald-300"
          : status === "cancelled"
            ? "bg-zinc-500/20 text-zinc-300"
            : status === "revision_requested"
              ? "bg-orange-500/20 text-orange-300"
              : "bg-zinc-500/15 text-zinc-300"; // pending_creator
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tone
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

// ─── Pure helpers ──────────────────────────────────────────

function formatPrice(amount: number, currency: string): string {
  const isZero = ZERO_DECIMAL_CURRENCIES.has(
    currency as Parameters<typeof ZERO_DECIMAL_CURRENCIES.has>[0]
  );
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: isZero ? 0 : 2,
  }).format(amount);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
