"use client";

/**
 * ServiceDetailDialog — visitor-facing read-only view of a creator
 * service. Opened by clicking a card on the Services tab.
 *
 * Layout:
 *
 *   DialogHero       — service title + category eyebrow
 *   DialogBody       — ServiceDetailSections (tags + tier compare)
 *   DialogFooter     — Close · Message creator · Start request
 *
 * "Message creator" opens a lightweight first-message modal
 * (ContactCreatorDialog) on top of this one — the buyer stays in
 * the service context and the new modal sends the inquiry.
 *
 * "Start request" is the questionnaire-first order entry; routes
 * to /services/:id/order (Phase 1c — for now still stubs to a
 * Phase 1c toast). Today we don't have that route mounted; once it
 * lands this CTA just becomes a Link.
 */
import { useState } from "react";
import { IconLoader2, IconMessage, IconUserPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { useCreatorService } from "@/app/(site)/creators/_hooks/use-creator-services";
import { ServiceDetailSections } from "./service-detail-sections";
import { ContactCreatorDialog } from "./contact-creator-dialog";
import { StartRequestDialog } from "./start-request-dialog";

const HERO_URL =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/web-assets/creator-service/creator-service-dialog-hero-20260521.png";

interface ServiceDetailDialogProps {
  serviceId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ServiceDetailDialog({ serviceId, onOpenChange }: ServiceDetailDialogProps) {
  const t = useTranslations("creatorService");
  const tc = useTranslations("common");
  const { data: service, isLoading } = useCreatorService(serviceId);
  const open = !!serviceId;
  const [contactOpen, setContactOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col overflow-hidden p-0 sm:max-w-3xl">
          <DialogHero
            src={HERO_URL}
            eyebrow={service ? t(`category.${service.category}`) : t("detailLoading")}
            title={service?.title ?? t("detailLoading")}
            description={service?.summary ?? ""}
            className="shrink-0"
          />

          <DialogBody className="min-h-0 flex-1 overflow-y-auto p-5">
            {isLoading || !service ? (
              <div className="flex h-40 items-center justify-center">
                <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ServiceDetailSections service={service} />
            )}
          </DialogBody>

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => onOpenChange(false)}
            >
              {tc("close")}
            </Button>
            <Button
              type="button"
              variant="outline"
              color="muted"
              onClick={() => setContactOpen(true)}
              disabled={!service}
            >
              <IconMessage className="size-4" />
              {t("detailMessageCreator")}
            </Button>
            <Button type="button" onClick={() => setRequestOpen(true)} disabled={!service}>
              <IconUserPlus className="size-4" />
              {t("detailStartRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stacked above ServiceDetailDialog — Radix handles z-index
          + focus trapping correctly for nested dialogs. */}
      <ContactCreatorDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        service={service ?? null}
      />
      <StartRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        service={service ?? null}
      />
    </>
  );
}
