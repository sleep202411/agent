"use client";

import { useEffect, useState } from "react";
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
          <DialogTitle>FizzStudio is in beta</DialogTitle>
          <DialogDescription>
            This is an early beta, so your work may be lost or reset without notice. When using the
            canvas and image / video generation, please download or back up anything important as
            you create it.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={acknowledge}>I understand</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
