"use client";

import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";

/**
 * Reusable KYC blocker. Open the dialog when the caller detects an
 * authStatus that isn't APPROVED. Single CTA routes to /kyc; cancel
 * lets the user dismiss the dialog (used at click-time gates so they
 * can back out without leaving the page).
 *
 * Caller owns the open/close state since the gate decision is
 * upstream — typically `if (authStatus !== APPROVED) setOpen(true)`.
 */
interface KycRequiredAlertProps {
  open: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Hide the cancel button when there's no graceful way to back out
   * (e.g. user already navigated to a publish-only page). */
  dismissible?: boolean;
}

export function KycRequiredAlert({
  open,
  onOpenChange,
  dismissible = true,
}: KycRequiredAlertProps) {
  const t = useTranslations("publishVideo");
  const router = useRouter();
  const locale = useLocale() as Locale;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("kycRequiredTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("kycRequiredBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {dismissible && <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>}
          <AlertDialogAction onClick={() => router.replace(localizePath("/kyc", locale))}>
            {t("kycRequiredCta")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
