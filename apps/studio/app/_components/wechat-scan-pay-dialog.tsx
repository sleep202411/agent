"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { IconCircleCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import QRCode from "qrcode";
import { getBillingOrder, isOrderDead, isOrderSettled } from "@/lib/billing";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { GlassRim } from "@/components/ui/glass-rim";

type ScanStatus = "pending" | "paid" | "expired";

const POLL_MS = 2500;

/**
 * WeChat Pay 扫码 (Native) payment surface. The checkout returned a `weixin://`
 * code_url — rendered here as a QR the user scans in the WeChat app. We poll the
 * order (which server-side 查单-reconciles a still-pending WeChat order) until it
 * settles, then fire onPaid. Monochrome frosted design (DESIGN.md); the QR itself
 * is black-on-white — a functional exception, not decoration — so scanners read it.
 */
export function WechatScanPayDialog({
  open,
  orderId,
  codeUrl,
  title,
  amountLabel,
  onClose,
  onPaid,
}: {
  open: boolean;
  orderId: string;
  codeUrl: string;
  title?: string;
  amountLabel?: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const t = useTranslations("billing");
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("pending");
  // Keep the latest onPaid without re-subscribing the poll loop (synced in an
  // effect, not during render). A fresh order remounts this dialog (parent keys it
  // on orderId), so `status` starts at "pending" without a reset effect.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  // Render the code_url to a QR data URL (black-on-white for scannability).
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

  // Poll order status while pending. Reading a pending WeChat order server-side
  // triggers a 查单 reconcile + fulfil, so this flips without the callback.
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
        // Transient network error — keep polling.
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
    // settings overlay) sets to pointer-events:none — without this the QR dialog
    // renders but can't be clicked/closed.
    <div
      className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <FrostedPanel className="relative overflow-hidden rounded-3xl p-6">
          <GlassRim />
          <div className="relative flex flex-col items-center gap-5">
            <div className="flex w-full items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {title ?? t("wechatScan.title")}
                </h2>
                {amountLabel ? <p className="mt-0.5 text-sm text-white/60">{amountLabel}</p> : null}
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t("wechatScan.close")}
                className="rounded-full p-1 text-white/50 transition hover:text-white"
              >
                <IconX size={18} />
              </button>
            </div>

            {status === "pending" ? (
              <>
                <div className="rounded-2xl bg-white p-3">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qr}
                      alt={t("wechatScan.title")}
                      width={224}
                      height={224}
                      className="block h-56 w-56"
                    />
                  ) : (
                    <div className="flex h-56 w-56 items-center justify-center">
                      <IconLoader2 size={28} className="animate-spin text-black/40" />
                    </div>
                  )}
                </div>
                <p className="text-center text-sm text-white/70">{t("wechatScan.instruction")}</p>
                <div className="flex items-center gap-1.5 text-xs text-white/40">
                  <IconLoader2 size={13} className="animate-spin" />
                  {t("wechatScan.waiting")}
                </div>
              </>
            ) : status === "paid" ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <IconCircleCheck size={56} className="text-white" />
                <p className="text-base font-medium text-white">{t("wechatScan.paid")}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10">
                <IconRefresh size={44} className="text-white/50" />
                <p className="text-base font-medium text-white">{t("wechatScan.expired")}</p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-1 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white transition hover:bg-white/15"
                >
                  {t("wechatScan.retry")}
                </button>
              </div>
            )}
          </div>
        </FrostedPanel>
      </div>
    </div>,
    document.body
  );
}
