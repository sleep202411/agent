"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconCircleCheck, IconCircleX, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { backendApi } from "@/src/lib/api";

type PaymentStatus = "loading" | "success" | "failed";

interface OrderStatusResponse {
  status: number;
  orderNo?: string;
  amount?: number;
  currency?: string;
}

export default function PaymentResultPage() {
  const t = useTranslations("payment");
  const searchParams = useSearchParams();
  const orderNo = searchParams.get("order_id") ?? searchParams.get("orderNo") ?? "";
  const [status, setStatus] = useState<PaymentStatus>("loading");
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);

  useEffect(() => {
    if (!orderNo) {
      setStatus("failed");
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;

    const checkStatus = async () => {
      try {
        const result = await backendApi.get<OrderStatusResponse>(
          `/api/payment/order/status/${orderNo}`
        );
        setOrder(result);

        if (result.status === 1) {
          setStatus("success");
          return true;
        }
        if (result.status === -1 || result.status === 2) {
          setStatus("failed");
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };

    const poll = async () => {
      const done = await checkStatus();
      if (!done && attempts < maxAttempts) {
        attempts++;
        setTimeout(() => void poll(), 3000);
      } else if (!done) {
        setStatus("failed");
      }
    };

    void poll();
  }, [orderNo]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        {status === "loading" && (
          <>
            <IconLoader2 className="mx-auto size-12 animate-spin text-primary" />
            <h1 className="mt-4 text-lg font-semibold text-foreground">{t("verifyingPayment")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("pleaseWait")}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-500/10">
              <IconCircleCheck className="size-10 text-green-500" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-foreground">{t("paymentSuccess")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("paymentSuccessDesc")}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              {t("orderNo")}: {orderNo}
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.self !== window.top) {
                  window.parent.postMessage({ type: "navigateToCreatorCenter" }, "*");
                } else {
                  window.history.back();
                }
              }}
              className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              {t("backToCreatorCenter")}
            </button>
          </>
        )}

        {status === "failed" && (
          <>
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/10">
              <IconCircleX className="size-10 text-destructive" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-foreground">{t("paymentFailed")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("paymentFailedDesc")}</p>
            {orderNo && (
              <p className="mt-4 text-xs text-muted-foreground">
                {t("orderNo")}: {orderNo}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
