"use client";

/**
 * KycGateDialog — blocking alert shown when the user tries to enter a flow
 * that requires real-name verification but hasn't completed it yet. Port of
 * the "实名认证 · 您还未完成实名认证 · 去认证" popup from fizzdragon-web.
 *
 * Usage: render it with `open` set from `useKycAuthStatus().data?.needAuth`,
 * the primary button navigates to /kyc and closes the parent flow.
 */
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
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";

interface KycGateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Custom message (default: generic "verification required"). */
  description?: string;
}

export function KycGateDialog({ open, onOpenChange, description }: KycGateDialogProps) {
  const t = useTranslations("kyc");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale() as Locale;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("gateTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{description ?? t("gateDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false);
              router.push(localizePath("/kyc", locale));
            }}
          >
            {t("goVerify")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
