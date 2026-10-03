"use client";

import type { Locale } from "@/src/i18n/config";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useState } from "react";
import Link from "next/link";
import { ORDER_STATUSES, type OrderStatus } from "@repo/shared/order";
import { useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useOrders } from "@/app/(site)/creators/_hooks/use-orders";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";

export default function OrdersPage() {
  const { user, isLoading } = useCurrentUser();
  const auth = useAuthDialog();
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const locale = useLocale() as Locale;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("list.title")}</h1>
        <Link
          href={localizePath("/messages", locale)}
          className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {t("backToInbox")}
        </Link>
      </header>
      {isLoading ? (
        <p role="status">{common("loading")}</p>
      ) : user ? (
        <OrdersList key={user.id} />
      ) : (
        <div className="space-y-3 py-8">
          <p>{t("list.signInRequired")}</p>
          <Button onClick={() => auth.open()}>{t("signIn")}</Button>
        </div>
      )}
    </main>
  );
}

function OrdersList() {
  const t = useTranslations("orders");
  const common = useTranslations("common");
  const locale = useLocale() as Locale;
  const [role, setRole] = useState<"both" | "buyer" | "creator">("both");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const query = useOrders({ role, status: status || undefined });
  // Failed authorization refreshes must not leave private cached orders visible.
  const denied = query.error?.status === 401 || query.error?.status === 403;
  const items = denied ? [] : (query.data?.items ?? []);
  const displays = useUserDisplays(items.map((order) => order.counterpartyId));
  const control = "h-9 rounded-md border border-border bg-background px-3 text-sm";
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("list.role")}
          <NativeSelect
            className={control}
            value={role}
            aria-label={t("list.role")}
            onChange={(value) => setRole(value as typeof role)}
          >
            <NativeSelectOption value="both">{t("list.allRoles")}</NativeSelectOption>
            <NativeSelectOption value="buyer">{t("list.buying")}</NativeSelectOption>
            <NativeSelectOption value="creator">{t("list.selling")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t("list.status")}
          <NativeSelect
            className={control}
            value={status}
            aria-label={t("list.status")}
            onChange={(value) => setStatus(value as typeof status)}
          >
            <NativeSelectOption value="">{t("list.allStatuses")}</NativeSelectOption>
            {ORDER_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`status.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {query.isLoading && (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          {common("loading")}
        </p>
      )}
      {query.isError && (
        <div role="alert" className="space-y-3 py-4">
          <p className="break-words text-sm">{query.error.message || common("loadFailed")}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            {common("retry")}
          </Button>
        </div>
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("list.empty")}</p>
      )}
      <ul className="divide-y divide-border">
        {items.map((order) => (
          <li key={order.id}>
            <Link
              href={localizePath(`/orders/${order.id}`, locale)}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-4 transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="min-w-0 flex-1 basis-60 space-y-1">
                <p className="break-words text-sm font-medium">{order.serviceTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {t(order.counterpartyRole === "creator" ? "list.buying" : "list.selling")} ·{" "}
                  {t(`tier.${order.packageTier}`)} ·{" "}
                  {displays.get(order.counterpartyId)?.nickname || order.counterpartyId}
                </p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                {t(`status.${order.status}`)}
              </span>
              <span className="text-sm tabular-nums">
                {new Intl.NumberFormat(locale, {
                  style: "currency",
                  currency: order.currency,
                }).format(order.totalPrice)}
              </span>
              {order.unreadCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t("list.unread", { count: order.unreadCount })}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {!denied && query.hasNextPage && !query.isFetchNextPageError && (
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? common("loading") : t("list.loadMore")}
        </Button>
      )}
    </>
  );
}
