"use client";

import { IconArrowRight, IconCrown } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStudioHref } from "@/src/lib/region/cell";

export interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Compute membership has one owner: the standalone Studio billing surface.
 *
 * Keep this adapter because the retiring Web workbenches still open an
 * `UpgradeDialog`, but never reproduce a plan catalog or payment flow here.
 * This prevents Web from growing a second plan catalog while those workbenches
 * are migrated to Studio.
 */
export function UpgradeDialog({ open, onOpenChange }: UpgradeDialogProps) {
  const locale = useLocale();
  const t = useTranslations("payment");
  const billingHref = `${getStudioHref(locale)}#settings/billing`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconCrown className="size-5 text-primary" />
            {t("upgrade")}
          </DialogTitle>
          <DialogDescription>{t("unlockMore")}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
          <Button asChild>
            <a href={billingHref}>
              {t("membership.getStarted")}
              <IconArrowRight className="size-4" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
