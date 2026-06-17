"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Bump the suffix to re-surface the notice after a material change. */
const ACK_KEY = "fizzstudio-beta-ack-v1";

/**
 * One-time beta / data-loss notice, shown on first entry to the studio and
 * remembered per browser so it doesn't nag. Mounted app-wide (grid + editor).
 */
export function BetaNotice() {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      if (!localStorage.getItem(ACK_KEY)) setOpen(true);
    } catch {
      setOpen(true); // storage blocked — show it (can't persist the ack)
    }
  }, []);

  const acknowledge = () => {
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {
      /* storage unavailable — the notice may reappear next visit */
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) acknowledge();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("beta.title")}</DialogTitle>
          <DialogDescription>{t("beta.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={acknowledge}>{t("beta.acknowledge")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
