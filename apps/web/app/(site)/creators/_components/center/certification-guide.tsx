"use client";
import { useState } from "react";
import { IconHelpCircle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { certificationGroups } from "./certification-guide-data";

export function CertificationGuide() {
  const t = useTranslations("certificationGuide");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("help")}
        onClick={() => setOpen(true)}
      >
        <IconHelpCircle className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-5">
            {certificationGroups.map((group) => (
              <section key={group.key} className="space-y-2">
                <h3 className="font-semibold">{t(group.key)}</h3>
                <dl className="space-y-3">
                  {group.entries.map((entry) => (
                    <div key={entry}>
                      <dt className="text-sm font-medium">{t(`${entry}Name`)}</dt>
                      <dd className="text-sm text-muted-foreground">{t(`${entry}Description`)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
