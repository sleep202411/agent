"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCircleCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import QRCode from "qrcode";
import { useTranslations } from "@/src/i18n/i18n";
import { getBillingOrder, isOrderDead, isOrderSettled } from "@/src/lib/billing/api";

type ScanStatus = "pending" | "paid" | "expired";
const POLL_MS = 2500;

/**
 * WeChat 扫码 (Native) payment surface for the NestJS `/aurora/billing` community
 * purchases (社区积分 / 社区会员). The checkout returned a `weixin://` code_url —
 * rendered here as a QR the buyer scans in the WeChat app (a desktop browser can't
 * navigate to `weixin://`). Polls `getBillingOrder` (which server-side 查单-
 * reconciles a still-pending order) until it settles, then fires onPaid.
 *
 * Two shells over one core:
 *  - `WechatScanPayPanel` — the QR + poll + status UI, embedded inline (e.g. the
 *    recharge dialog's right-hand payment column, mirroring the WeChat
 *    merchant-platform 经营场景 reference where the QR lives beside the SKU list).
 *  - `WechatScanPayDialog` — the same panel in a modal overlay (legacy callers).
 */
export function WechatScanPayDialog({
  open,
  orderId,
  codeUrl,
  amountLabel,
  onClose,
  onPaid,
}: {
  open: boolean;
  orderId: string;
  codeUrl: string;
  amountLabel?: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const t = useTranslations("payment");
  if (!open) return null;

  return createPortal(
    // pointer-events-auto: this portals to <body>, which a Radix modal (the
    // billing dialog) sets to pointer-events:none — without this the QR dialog
    // renders but can't be clicked/closed.
    <div
      className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t("wechatPay")}</h2>
            {amountLabel ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{amountLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-full p-1 text-muted-foreground transition hover:text-foreground"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="mt-5">
          <WechatScanPayPanel
            orderId={orderId}
            codeUrl={codeUrl}
            amountLabel={amountLabel}
            onPaid={onPaid}
            onExpired={onClose}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Inline 扫码支付面板 — QR + poll + status, no overlay. Callers key it on
 * orderId so a fresh order remounts it in "pending" without a reset effect.
 */
export function WechatScanPayPanel({
  orderId,
  codeUrl,
  amountLabel,
  onPaid,
  onExpired,
}: {
  orderId: string;
  codeUrl: string;
  amountLabel?: string;
  onPaid: () => void;
  /** Fired when the order is dead/expired — the parent typically resets back to
   *  package selection so the buyer can retry. */
  onExpired: () => void;
}) {
  const t = useTranslations("payment");
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("pending");
  // Keep the latest onPaid without re-subscribing the poll loop (synced in an
  // effect, not during render).
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    if (!codeUrl) return;
    let alive = true;
    QRCode.toDataURL(codeUrl, {
      width: 224,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [codeUrl]);

  useEffect(() => {
    if (status !== "pending") return;
    let alive = true;
    const tick = async () => {
      try {
        const { order } = await getBillingOrder(orderId);
        if (!alive) return;
        if (isOrderSettled(order.status)) {
          setStatus("paid");
          onPaidRef.current();
        } else if (isOrderDead(order.status)) {
          setStatus("expired");
        }
      } catch {
        // Transient — keep polling.
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);
    void tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [orderId, status]);

  if (status === "pending") {
    return (
      <div className="flex flex-col items-center gap-3">
        {amountLabel ? (
          <p className="text-sm font-semibold tabular-nums text-foreground">{amountLabel}</p>
        ) : null}
        <div className="rounded-xl bg-white p-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={t("scanToPay")} width={224} height={224} className="block size-52" />
          ) : (
            <div className="flex size-52 items-center justify-center">
              <IconLoader2 size={28} className="animate-spin text-black/40" />
            </div>
          )}
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {t("scanToPay")}
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <IconLoader2 size={12} className="animate-spin" />
          {t("verifyingPayment")}
        </div>
      </div>
    );
  }

  if (status === "paid") {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <IconCircleCheck size={48} className="text-foreground" />
        <p className="text-sm font-medium text-foreground">{t("paymentSuccess")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <IconRefresh size={40} className="text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{t("paymentFailed")}</p>
      <button
        type="button"
        onClick={onExpired}
        className="mt-1 rounded-full bg-muted px-4 py-1.5 text-sm text-foreground transition hover:bg-muted/70"
      >
        {t("close")}
      </button>
    </div>
  );
}
