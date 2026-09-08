"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";

// Presentation only: opening this information does not establish eligibility.
export function CrewEligibilityNotice({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("crew.creationRequirements");
  const subject = t("subject");
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          // This controlled dialog has no Radix DialogTrigger of its own.
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
          returnFocus.current = null;
        }}
      >
        <div className="space-y-4 p-4">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("eligibility")}</DialogDescription>
          <p>{t("instructions")}</p>
          <a
            className="inline-block underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
            href={`mailto:business@fizzdragon.com?subject=${encodeURIComponent(subject)}`}
          >
            business@fizzdragon.com
          </a>
          <p>{t("subjectInstruction")}</p>
          <p className="break-words font-medium">{subject}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("dismiss")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
