"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("pending");
  // Keep the latest onPaid without re-subscribing the poll loop (synced in an
  // effect, not during render). Parent keys this dialog on orderId → a fresh
  // order remounts, so `status` starts "pending" without a reset effect.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    if (!open || !codeUrl) return;
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
  }, [open, codeUrl]);

  useEffect(() => {
    if (!open || status !== "pending") return;
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
  }, [open, orderId, status]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  if (!open) return null;

  return createPortal(
    // pointer-events-auto: this portals to <body>, which a Radix modal (the
    // billing dialog) sets to pointer-events:none — without this the QR dialog
    // renders but can't be clicked/closed.
    <div
      className="pointer-events-auto fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
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
            onClick={handleClose}
            aria-label={t("close")}
            className="rounded-full p-1 text-muted-foreground transition hover:text-foreground"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="mt-5 flex flex-col items-center gap-4">
          {status === "pending" ? (
            <>
              <div className="rounded-xl bg-white p-3">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qr}
                    alt={t("scanToPay")}
                    width={224}
                    height={224}
                    className="block size-56"
                  />
                ) : (
                  <div className="flex size-56 items-center justify-center">
                    <IconLoader2 size={28} className="animate-spin text-black/40" />
                  </div>
                )}
              </div>
              <p className="text-center text-sm text-muted-foreground">{t("scanToPay")}</p>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconLoader2 size={13} className="animate-spin" />
                {t("verifyingPayment")}
              </div>
            </>
          ) : status === "paid" ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <IconCircleCheck size={56} className="text-foreground" />
              <p className="text-base font-medium text-foreground">{t("paymentSuccess")}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10">
              <IconRefresh size={44} className="text-muted-foreground" />
              <p className="text-base font-medium text-foreground">{t("paymentFailed")}</p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-1 rounded-full bg-muted px-4 py-1.5 text-sm text-foreground transition hover:bg-muted/70"
              >
                {t("close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
