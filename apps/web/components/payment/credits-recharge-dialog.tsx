"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { IconCheck, IconCircleCheckFilled, IconLoader2 } from "@tabler/icons-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { backendApi, ApiRequestError } from "@/src/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { siteConfig } from "@/src/config/site";

// ── Types ───────────────────────────────────────────────────

interface CreditsPackage {
  id: number;
  integralAmount: number;
  originalPrice: number;
  discountPrice: number;
  status: number;
  sortOrder: number;
}

interface RechargeResult {
  orderNo: string;
  url: string;
}
interface OrderStatus {
  status: number;
}

type Step = "select" | "payment" | "success";

/**
 * Which credit ledger this dialog tops up.
 *
 * - `studio`    — paid AI generation credits used inside Art Studio
 *                 (image / video gen). Backed by /api/payment/query/package
 *                 and productType 1.
 * - `community` — wallet for unlocking paid IP content. Backed by
 *                 /api/payment/query/point/package and productType 3.
 *
 * Backend reuses the same checkout pipeline for both — only the
 * package list endpoint and the productType discriminator change. The
 * dialog UI itself is identical, so we parameterise here rather than
 * fork the component.
 */
export type CreditsKind = "studio" | "community";

interface KindConfig {
  packageEndpoint: string;
  productType: number;
  wechatType: number;
}

const KIND_CONFIG: Record<CreditsKind, KindConfig> = {
  studio: {
    packageEndpoint: "/api/payment/query/package",
    productType: 1,
    wechatType: 1,
  },
  community: {
    packageEndpoint: "/api/payment/query/point/package",
    productType: 3,
    wechatType: 3,
  },
};

export interface CreditsRechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Which credit type to top up. Defaults to `"studio"` for legacy
   *  callers that predate the community-credits split. */
  kind?: CreditsKind;
}

// ── Component ───────────────────────────────────────────────

export function CreditsRechargeDialog({
  open,
  onOpenChange,
  onSuccess,
  kind = "studio",
}: CreditsRechargeDialogProps) {
  const t = useTranslations("payment");
  const locale = useLocale();
  const config = KIND_CONFIG[kind];

  const [packages, setPackages] = useState<CreditsPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>("select");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [currency, setCurrency] = useState(siteConfig.defaultCurrency);
  const [qrUrl, setQrUrl] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [paying, setPaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedPackage = packages.find((p) => p.id === selectedId) ?? null;
  const displayPrice = (amount: number | string) => {
    const num = Number(amount);
    return siteConfig.region === "cn" ? (num / 100).toFixed(2) : num.toFixed(2);
  };
  const currencySymbol = siteConfig.currencies.find((c) => c.code === currency)?.symbol ?? "$";

  // ── Fetch ───────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedId(null);
    backendApi
      .post<CreditsPackage[]>(config.packageEndpoint, { data: { currency } })
      .then((res) => {
        const list = (res ?? [])
          .filter((p) => p.status === 1 || (p.status as unknown) === "ACTIVE")
          .sort((a, b) => a.sortOrder - b.sortOrder);
        setPackages(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => setPackages([]))
      .finally(() => setLoading(false));
  }, [open, currency, config.packageEndpoint]);

  useEffect(() => {
    if (!open) {
      setStep("select");
      setQrUrl("");
      setOrderNo("");
      setPaying(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [open]);

  useEffect(
    () => () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    },
    []
  );

  // ── Payment ─────────────────────────────────────────────

  const handlePay = useCallback(async () => {
    if (!selectedPackage) return;
    setPaying(true);
    try {
      if (siteConfig.region === "cn") {
        // WeChat Pay: show QR code
        const result = await backendApi.post<RechargeResult>("/api/payment/wechat/recharge", {
          data: { packageId: Number(selectedPackage.id), type: config.wechatType },
        });
        const qrDataUrl = await QRCode.toDataURL(result.url, { width: 256, margin: 2 });
        setQrUrl(qrDataUrl);
        setOrderNo(result.orderNo);
        setStep("payment");
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const s = await backendApi.get<OrderStatus>(
              `/api/payment/order/status/${result.orderNo}`
            );
            if (s.status === 1) {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setStep("success");
              onSuccess?.();
            }
          } catch {
            /* ignore */
          }
        }, 3000);
      } else {
        // Airwallex: redirect to payment page
        const result = await backendApi.post<{ checkoutUrl: string; orderNo: string }>(
          "/api/payment/order/create",
          {
            data: {
              productId: selectedPackage.id,
              productType: config.productType,
              // Send the real result page; Java appends `?order_id=<orderNo>`.
              // Must be query-less (Java hardcodes `?order_id=`, so a query
              // here would produce a double `?`). Without this, Java falls
              // back to the dead legacy `pages/payment/result` path → 404.
              successUrl: `${window.location.origin}/${locale}/payment/result`,
            },
          }
        );
        if (result.checkoutUrl) {
          if (window.self !== window.top) {
            window.parent.postMessage({ type: "navigateToPayment", url: result.checkoutUrl }, "*");
          } else {
            window.location.href = result.checkoutUrl;
          }
        } else {
          // Backend returned 200 OK but no checkoutUrl — previously the
          // button just stopped spinning silently and the user had no
          // signal anything went wrong. Surface a hint so they can
          // retry or report it.
          toast.error(t("paymentNoCheckoutUrl"));
        }
      }
    } catch (e) {
      console.error("[CreditsRecharge]", e);
      const apiMsg = e instanceof ApiRequestError ? e.message : null;
      const fallback = e instanceof Error ? e.message : null;
      toast.error(apiMsg || fallback || t("paymentFailed"));
    } finally {
      setPaying(false);
    }
  }, [selectedPackage, onSuccess, config.productType, config.wechatType, t, locale]);

  const handleAlreadyPaid = useCallback(async () => {
    if (!orderNo) return;
    try {
      const s = await backendApi.get<OrderStatus>(`/api/payment/order/status/${orderNo}`);
      if (s.status === 1) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setStep("success");
        onSuccess?.();
      }
    } catch {
      /* ignore */
    }
  }, [orderNo, onSuccess]);

  // ── Render ──────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("credits")}</DialogTitle>
          <DialogDescription className="sr-only">{t("creditsRechargeDesc")}</DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 p-4">
            {/* Currency switcher */}
            {siteConfig.currencies.length > 1 && (
              <div className="flex items-center justify-center gap-1 rounded-full border border-border bg-muted/30 p-1">
                {siteConfig.currencies.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCurrency(c.code)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-xs font-medium transition-all",
                      currency === c.code
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {c.symbol} {c.code}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {packages.map((pkg) => {
                  const isSelected = selectedId === pkg.id;
                  const hasDiscount =
                    pkg.originalPrice > 0 && pkg.discountPrice < pkg.originalPrice;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setSelectedId(pkg.id)}
                      className={cn(
                        "flex flex-col items-center rounded-xl border p-4 transition-all",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:border-border"
                      )}
                    >
                      <div className="text-2xl font-bold">{pkg.integralAmount}</div>
                      <div className="mb-3 text-xs text-muted-foreground">{t("creditsUnit")}</div>
                      <div className="text-lg font-semibold">
                        <span className="text-sm font-normal text-muted-foreground">
                          {currencySymbol}
                        </span>
                        {displayPrice(pkg.discountPrice)}
                      </div>
                      {hasDiscount && (
                        <div className="mt-0.5 text-xs text-muted-foreground/50 line-through">
                          {currencySymbol}
                          {displayPrice(pkg.originalPrice)}
                        </div>
                      )}
                      {isSelected && <IconCheck className="mt-2 size-4 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}

            {selectedPackage && (
              <Button className="w-full" onClick={() => void handlePay()} disabled={paying}>
                {paying && <IconLoader2 className="size-4 animate-spin" />}
                {siteConfig.region === "cn" ? t("wechatPay") : t("payNow")} {currencySymbol}
                {displayPrice(selectedPackage.discountPrice)}
              </Button>
            )}
          </div>
        )}

        {step === "payment" && (
          <div className="flex flex-col items-center py-4">
            <p className="mb-4 text-sm text-muted-foreground">{t("scanToPay")}</p>
            <div className="mb-6 rounded-xl bg-white p-4">
              <img src={qrUrl} alt="QR" className="size-48" />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                color="muted"
                size="sm"
                onClick={() => {
                  if (pollRef.current) {
                    clearInterval(pollRef.current);
                    pollRef.current = null;
                  }
                  setQrUrl("");
                  setOrderNo("");
                  setStep("select");
                }}
              >
                {t("changePlan")}
              </Button>
              <Button variant="soft" size="sm" onClick={() => void handleAlreadyPaid()}>
                {t("alreadyPaid")}
              </Button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center py-6">
            <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-primary/10">
              <IconCircleCheckFilled className="size-9 text-primary" />
            </div>
            <h3 className="mb-1 text-base font-semibold">{t("paymentSuccess")}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{t("paymentSuccessDesc")}</p>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              {t("close")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
