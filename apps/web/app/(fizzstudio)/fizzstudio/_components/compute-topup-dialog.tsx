"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  IconBolt,
  IconCheck,
  IconCreditCard,
  IconLoader2,
  IconPlus,
  IconWallet,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ApiRequestError } from "@/src/lib/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import {
  availableComputeBalance,
  useComputeTopupCatalog,
  useComputeWalletLedger,
  useCreateComputeTopup,
} from "../../_hooks/use-billing";
import type { ComputeTopupPrice } from "../../_lib/billing-api";

type IdempotencyState = {
  sig: string;
  key: string;
};

export function ComputeTopupButton({ variant }: { variant: "enterprise" | "studio" }) {
  const t = useTranslations("fizzStudio");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const wallet = useComputeWalletLedger();
  const balance = availableComputeBalance(wallet.data);
  const returnStatus = searchParams.get("computeTopup");

  useEffect(() => {
    if (!returnStatus) return;
    if (returnStatus === "success") {
      toast.success(t("computeBilling.completedToast"));
      void wallet.refetch();
    } else if (returnStatus === "cancelled") {
      toast.info(t("computeBilling.cancelledToast"));
    }

    const next = new URLSearchParams(searchParams.toString());
    next.delete("computeTopup");
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    // searchParams intentionally stays in deps so repeated provider returns are handled.
  }, [pathname, returnStatus, router, searchParams, t, wallet]);

  const label = wallet.isLoading
    ? t("computeBilling.balanceLoading")
    : t("computeBilling.balance", { amount: formatInteger(balance) });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex h-10 max-w-[220px] items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors",
          variant === "enterprise"
            ? "border-white/12 bg-black/22 text-white shadow-[0_14px_34px_rgba(0,0,0,0.28)] hover:bg-white/10"
            : "border-white/10 bg-[#202024] text-white/86 hover:bg-[#2b2b31] hover:text-white"
        )}
        aria-label={t("computeBilling.openRecharge")}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e92d32] text-white">
          <IconBolt className="size-4" />
        </span>
        <span className="min-w-0 truncate">{label}</span>
        <IconPlus className="size-4 shrink-0 text-white/70" />
      </button>
      <ComputeTopupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ComputeTopupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("fizzStudio");
  const locale = useLocale();
  const catalog = useComputeTopupCatalog();
  const wallet = useComputeWalletLedger();
  const createTopup = useCreateComputeTopup();
  const [selectedPriceId, setSelectedPriceId] = useState("");
  const idemRef = useRef<IdempotencyState | null>(null);

  const prices = useMemo(() => catalog.data?.prices ?? [], [catalog.data?.prices]);
  const selectedPrice = useMemo(
    () => prices.find((price) => price.id === selectedPriceId) ?? prices[0] ?? null,
    [prices, selectedPriceId]
  );
  const balance = availableComputeBalance(wallet.data);

  async function handleSubmit() {
    if (!selectedPrice || !catalog.data) return;
    const sig = selectedPrice.id;
    if (!idemRef.current || idemRef.current.sig !== sig) {
      idemRef.current = { sig, key: crypto.randomUUID() };
    }

    const base = `${window.location.origin}${window.location.pathname}`;
    const successUrl = `${base}?computeTopup=success`;
    const backUrl = `${base}?computeTopup=cancelled`;

    try {
      const result = await createTopup.mutateAsync({
        priceId: selectedPrice.id,
        provider: catalog.data.provider,
        idempotencyKey: idemRef.current.key,
        successUrl,
        backUrl,
      });

      if (result.order.status === "fulfilled" && !result.paymentIntent) {
        toast.success(t("computeBilling.successToast"));
        onOpenChange(false);
        return;
      }

      const pi = result.paymentIntent;
      if (pi?.checkoutUrl) {
        window.location.assign(pi.checkoutUrl);
        return;
      }

      if (result.order.provider === "airwallex" && pi?.providerPaymentIntentId && pi.clientSecret) {
        const { init } = await import("@airwallex/components-sdk");
        const aw = await init({ env: result.env, enabledElements: ["payments"] });
        if (!aw.payments) {
          idemRef.current = null;
          toast.error(t("computeBilling.paymentFailed"));
          return;
        }
        await aw.payments.redirectToCheckout({
          env: result.env,
          mode: "payment",
          intent_id: pi.providerPaymentIntentId,
          client_secret: pi.clientSecret,
          currency: result.order.currency,
          country_code: result.shopperCountry,
          successUrl,
          failUrl: backUrl,
        });
        return;
      }

      idemRef.current = null;
      toast.error(t("computeBilling.providerUnavailable"));
    } catch (error) {
      idemRef.current = null;
      const message =
        error instanceof ApiRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : t("computeBilling.paymentFailed");
      toast.error(message);
    }
  }

  const canSubmit = Boolean(selectedPrice) && !catalog.isLoading && !createTopup.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden rounded-[8px] border border-white/10 bg-[#151516] text-white shadow-2xl sm:max-w-[720px]">
        <DialogHeader className="border-white/10 px-5 py-4">
          <DialogTitle className="text-lg font-semibold tracking-normal text-white">
            {t("computeBilling.dialogTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[calc(100vh-12rem)] overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex items-center gap-3 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[#e92d32] text-white">
                <IconWallet className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-white/54">
                  {t("computeBilling.availableBalance")}
                </p>
                <p className="mt-0.5 truncate text-2xl font-semibold tracking-normal text-white">
                  {formatInteger(balance)}
                </p>
              </div>
            </div>
            {catalog.data ? (
              <div className="rounded-[8px] border border-white/10 bg-white/[0.035] px-3 py-3 text-[12px] leading-5 text-white/58 sm:max-w-[260px]">
                {catalog.data.rateMode === "usd_cent_anchor"
                  ? t("computeBilling.usdRate")
                  : t("computeBilling.explicitRate")}
              </div>
            ) : null}
          </div>

          {catalog.isLoading ? (
            <div className="grid min-h-[220px] place-items-center rounded-[8px] border border-white/10 bg-white/[0.03] text-white/60">
              <IconLoader2 className="size-5 animate-spin" />
            </div>
          ) : prices.length === 0 ? (
            <div className="rounded-[8px] border border-white/10 bg-white/[0.03] px-4 py-8 text-center">
              <p className="text-sm font-semibold text-white">{t("computeBilling.emptyTitle")}</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/58">
                {t("computeBilling.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {prices.map((price) => (
                <TopupPackageCard
                  key={price.id}
                  price={price}
                  locale={locale}
                  selected={price.id === selectedPrice?.id}
                  onSelect={() => setSelectedPriceId(price.id)}
                />
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="border-white/10 bg-[#111112] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            color="muted"
            className="border-white/12 text-white/72 hover:bg-white/8 hover:text-white"
            onClick={() => onOpenChange(false)}
            disabled={createTopup.isPending}
          >
            {t("computeBilling.cancel")}
          </Button>
          <Button
            type="button"
            className="min-w-[180px] bg-[#e92d32] text-white hover:bg-[#ff343a]"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {createTopup.isPending ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconCreditCard className="size-4" />
            )}
            {selectedPrice
              ? t("computeBilling.payNowWithAmount", {
                  amount: formatMoneyMinor(
                    selectedPrice.amountMinor,
                    selectedPrice.currency,
                    locale
                  ),
                })
              : t("computeBilling.payNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TopupPackageCard({
  price,
  selected,
  locale,
  onSelect,
}: {
  price: ComputeTopupPrice;
  selected: boolean;
  locale: string;
  onSelect: () => void;
}) {
  const t = useTranslations("fizzStudio");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative grid min-h-[156px] rounded-[8px] border p-4 text-left transition-colors",
        selected
          ? "border-[#e92d32] bg-[#2a1718]"
          : "border-white/10 bg-white/[0.035] hover:border-white/22 hover:bg-white/[0.06]"
      )}
    >
      <span className="text-[12px] font-medium text-white/48">{price.name}</span>
      <span className="mt-3 text-3xl font-semibold tracking-normal text-white">
        {formatInteger(price.grantsWalletAmount)}
      </span>
      <span className="mt-1 text-sm text-white/52">{t("computeBilling.points")}</span>
      <span className="mt-5 text-xl font-semibold tracking-normal text-white">
        {formatMoneyMinor(price.amountMinor, price.currency, locale)}
      </span>
      {selected ? (
        <span className="absolute bottom-3 right-3 grid size-6 place-items-center rounded-full bg-[#e92d32] text-white">
          <IconCheck className="size-4" />
        </span>
      ) : null}
    </button>
  );
}

function formatInteger(value: bigint | string | number) {
  return new Intl.NumberFormat().format(Number(value));
}

function formatMoneyMinor(amountMinor: string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amountMinor) / 100);
}
