"use client";
import { useDeferredValue, useEffect, useId, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  listIpCommerceIps,
  listMyReportPurchases,
  reportIpContent,
  type CreateIpReportInput,
} from "@/src/lib/ip-commerce/api";

export function ContentReportForm({
  userId,
  purchase = false,
  onClose,
  onSubmitted,
}: {
  userId: string;
  purchase?: boolean;
  onClose: () => void;
  onSubmitted: (report: { id: string; status: string }) => void;
}) {
  const descriptionId = useId();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const t = useTranslations("contentReports"),
    reportT = useTranslations("newIpDetail.report"),
    locale = useLocale();
  const [search, setSearch] = useState("");
  const searchQuery = useDeferredValue(search.trim());
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState<CreateIpReportInput["reason"]>(
    purchase ? "payment" : "copyright"
  );
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false),
    busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const contentResults = useInfiniteQuery({
    enabled: !purchase,
    queryKey: ["content-report-targets", userId, locale, searchQuery],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      listIpCommerceIps(
        { q: searchQuery || undefined, locale, cursor: pageParam, limit: 20 },
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const purchaseResults = useInfiniteQuery({
    enabled: purchase,
    queryKey: ["report-purchases", userId, searchQuery],
    retry: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      listMyReportPurchases(
        { query: searchQuery || undefined, cursor: pageParam, limit: 20 },
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const results = purchase ? purchaseResults : contentResults;
  const ownedPurchases = purchaseResults.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedPurchase = ownedPurchases.find((item) => item.id === targetId);
  const targetLabel = t(purchase ? "purchaseTarget" : "target");
  return (
    <form
      className="space-y-4 rounded-xl bg-white/[0.03] p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy.current || !targetId || results.isError) return;
        busy.current = true;
        setPending(true);
        setError(null);
        try {
          if (purchase && !selectedPurchase) return;
          const payload: CreateIpReportInput = {
            targetType: selectedPurchase?.targetType ?? "ip",
            targetId: selectedPurchase
              ? (selectedPurchase.episodeId ?? selectedPurchase.ipId)
              : targetId,
            ...(selectedPurchase ? { purchaseOrderId: selectedPurchase.id } : {}),
            reason,
            description: description.trim() || undefined,
          };
          const fingerprint = JSON.stringify(payload);
          if (request.current?.fingerprint !== fingerprint)
            request.current = { fingerprint, id: crypto.randomUUID() };
          const result = await reportIpContent({ ...payload, requestId: request.current.id });
          if (active.current) onSubmitted(result.report);
        } catch (cause) {
          if (active.current) setError(cause instanceof Error ? cause.message : reportT("failed"));
        } finally {
          busy.current = false;
          if (active.current) setPending(false);
        }
      }}
    >
      <h2 className="text-base font-semibold">{t(purchase ? "newPurchaseReport" : "newReport")}</h2>
      {purchase ? <p className="text-sm text-muted-foreground">{t("purchaseHint")}</p> : null}
      <label className="block space-y-2 text-sm">
        <span>{t(purchase ? "purchaseSearch" : "search")}</span>
        <Input
          maxLength={180}
          disabled={pending}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setTargetId("");
          }}
        />
      </label>
      {results.isPending ? <p role="status">{t("loading")}</p> : null}
      {results.error ? (
        <div role="alert">
          <p>{results.error.message}</p>
          <Button
            type="button"
            disabled={pending || results.isFetching}
            onClick={() => void results.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <label className="block space-y-2 text-sm">
          <span>
            {targetLabel}{" "}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </span>
          <NativeSelect
            disabled={pending}
            value={targetId}
            onChange={setTargetId}
            aria-label={targetLabel}
          >
            <NativeSelectOption value="">{t("selectTarget")}</NativeSelectOption>
            {purchase
              ? ownedPurchases.map((order) => (
                  <NativeSelectOption key={order.id} value={order.id}>
                    {order.orderNo}
                  </NativeSelectOption>
                ))
              : contentResults.data?.pages
                  .flatMap((page) => page.items)
                  .map((ip) => (
                    <NativeSelectOption key={ip.id} value={ip.id}>
                      {ip.title} · {ip.roomNumber}
                    </NativeSelectOption>
                  ))}
          </NativeSelect>
        </label>
      )}
      {purchase && !results.isPending && !results.isError && ownedPurchases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noPurchases")}</p>
      ) : null}
      {selectedPurchase ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>{t("purchaseReference", { id: selectedPurchase.id })}</p>
          <p>
            {t("purchaseAmount", {
              amount: selectedPurchase.totalAmount,
              currency:
                selectedPurchase.currency === "community_point"
                  ? t("communityPoints")
                  : selectedPurchase.currency,
            })}
          </p>
          <p>{t("purchaseStatus", { status: t(`purchaseStatuses.${selectedPurchase.status}`) })}</p>
        </div>
      ) : null}
      {results.hasNextPage && !results.isError ? (
        <Button
          type="button"
          disabled={pending || results.isFetching}
          onClick={() => void results.fetchNextPage()}
        >
          {t("more")}
        </Button>
      ) : null}
      <label className="block space-y-2 text-sm">
        <span>
          {reportT("reason")}{" "}
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        </span>
        <NativeSelect
          disabled={pending}
          value={reason}
          onChange={(value) => setReason(value as CreateIpReportInput["reason"])}
        >
          {(
            [
              ...(purchase ? ["payment" as const] : []),
              "copyright",
              "unsafe_content",
              "fraud",
              "misleading",
              "privacy",
              "harassment",
              "other",
            ] as const
          ).map((key) => (
            <NativeSelectOption key={key} value={key}>
              {reportT(`reasons.${key}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <div className="space-y-2 text-sm">
        <label htmlFor={descriptionId}>{reportT("description")}</label>
        <Textarea
          id={descriptionId}
          disabled={pending}
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("evidenceHint")}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" color="muted" variant="ghost" disabled={pending} onClick={onClose}>
          {reportT("cancel")}
        </Button>
        <Button type="submit" disabled={pending || !targetId || results.isError}>
          {reportT(pending ? "submitting" : "submit")}
        </Button>
      </div>
    </form>
  );
}
