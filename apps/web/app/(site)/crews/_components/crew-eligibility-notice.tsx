"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import {
  AI_PRODUCER_LEVEL_ID,
  LevelApplyDialog,
} from "@/app/(site)/creators/_components/center/dialogs/level-apply-dialog";

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
  const [applyOpen, setApplyOpen] = useState(false);

  return (
    <>
      {/* Keep this tree mounted while the apply dialog is open: CreateCrewDialog
          returns null when `open` becomes false, which would unmount LevelApplyDialog. */}
      <Dialog open={open && !applyOpen} onOpenChange={onOpenChange}>
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
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("dismiss")}
            </Button>
            <Button type="button" onClick={() => setApplyOpen(true)}>
              {t("applyCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LevelApplyDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        lockedLevelId={AI_PRODUCER_LEVEL_ID}
      />
    </>
  );
}
