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

/**
 * Beta / data-loss notice, shown on every fresh Studio entry. Mounted app-wide
 * (grid + editor); the locale layout is reused across in-app navigation, so it
 * won't re-open repeatedly while moving between Studio pages.
 */
export function BetaNotice() {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOpen(true);
  }, []);

  const acknowledge = () => {
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
