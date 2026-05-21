"use client";

/**
 * ServiceDetailDialog — visitor-facing read-only view of a creator
 * service. Opened by clicking a card on the Services tab.
 *
 * Layout:
 *
 *   DialogHero       — service title + category eyebrow
 *   DialogBody       — ServiceDetailSections (tags + tier compare)
 *   DialogFooter     — Close · Message · Start request (Phase 1b stub)
 *
 * Phase 1a CTAs ("立即下单 / 联系创作者") toast Phase 1b hint
 * because the order/message systems don't exist yet. Layout is
 * built so plugging real handlers is one prop change.
 */
import { IconLoader2, IconMessage, IconUserPlus } from "@tabler/icons-react";
import { toast } from "sonner";
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

  return (
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
          <Button type="button" variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("close")}
          </Button>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => toast.info(t("ctaPhase1bMessage"))}
          >
            <IconMessage className="size-4" />
            {t("detailMessageCreator")}
          </Button>
          <Button
            type="button"
            onClick={() => toast.info(t("ctaPhase1bOrder"))}
            disabled={!service}
          >
            <IconUserPlus className="size-4" />
            {t("detailStartRequest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
