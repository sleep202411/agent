"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconCircleCheck, IconCircleX, IconLoader2 } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { backendApi } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { axonPurchase } from "@/src/lib/axon";

type PaymentStatus = "loading" | "success" | "failed" | "pending" | "error";

interface OrderStatusResponse {
  status: number;
  orderNo?: string;
  amount?: number;
  currency?: string;
}

export default function PaymentResultPage() {
  const searchParams = useSearchParams();
  const orderNo = searchParams?.get("order_id") ?? searchParams?.get("orderNo") ?? "";
  const { user } = useCurrentUser();
  const [purchases] = useState(() => new Set<string>());
  return (
    <PaymentResult
      key={JSON.stringify([orderNo, user?.id])}
      orderNo={orderNo}
      user={user}
      purchases={purchases}
    />
  );
}

function PaymentResult({
  orderNo,
  user,
  purchases,
}: {
  orderNo: string;
  user: ReturnType<typeof useCurrentUser>["user"];
  purchases: Set<string>;
}) {
  const t = useTranslations("payment");
  const locale = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>(orderNo ? "loading" : "error");
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orderNo) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const poll = async () => {
      try {
        const result = await backendApi.get<OrderStatusResponse>(
          `/api/payment/order/status/${encodeURIComponent(orderNo)}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        setOrder(result);
        if (result.status === 1) {
          setStatus("success");
        } else if (result.status === -1 || result.status === 2) {
          setStatus("failed");
        } else if (++attempts < 10) {
          timer = setTimeout(() => void poll(), 3000);
        } else {
          // A pending order is not evidence that payment failed.
          setStatus("pending");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : "");
        setStatus("error");
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [orderNo, attempt]);

  // Fire the AppLovin `purchase` conversion exactly once, when the order
  // confirms. No-op on the CN build / when the pixel key is unset (axon.ts).
  useEffect(() => {
    if (status !== "success") return;
    const transactionId = order?.orderNo ?? orderNo;
    if (purchases.has(transactionId)) return;
    purchases.add(transactionId);
    const value = order?.amount ?? 0;
    const currency = order?.currency ?? "USD";
    axonPurchase({
      transactionId,
      value,
      currency,
      items: [{ item_id: transactionId, item_name: "FizzDragon order", price: value, quantity: 1 }],
      userData: user
        ? { user_id: user.id, email: user.email ? user.email.toLowerCase() : undefined }
        : undefined,
    });
  }, [status, order, orderNo, user, purchases]);

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
            <p className="mt-2 text-sm text-muted-foreground">{t("paymentConfirmedDesc")}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              {t("orderNo")}: {orderNo}
            </p>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/art-studio`)}
              className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              {t("backToStudio")}
            </button>
          </>
        )}

        {(status === "pending" || status === "error") && (
          <>
            <h1 className="text-lg font-semibold text-foreground">
              {t(orderNo ? "paymentUnconfirmed" : "missingOrder")}
            </h1>
            <p
              className="mt-2 break-words text-sm text-muted-foreground"
              role={status === "error" ? "alert" : "status"}
            >
              {error || t(orderNo ? "paymentUnconfirmedDesc" : "missingOrderDesc")}
            </p>
            {orderNo && (
              <>
                <p className="mt-4 break-all text-xs text-muted-foreground">
                  {t("orderNo")}: {orderNo}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setStatus("loading");
                    setAttempt((value) => value + 1);
                  }}
                  className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-110"
                >
                  {t("checkAgain")}
                </button>
              </>
            )}
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
