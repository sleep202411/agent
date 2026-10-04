"use client";

import { useTranslations } from "next-intl";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InteractiveFilmPublication } from "@/lib/interactive-film-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";
import { storyPublicationErrorKind } from "../../_lib/story-publication-errors";

export function StoryPublicationStatus({
  publication,
  pending,
  error,
  refetching,
  onRetry,
  onSignIn,
}: {
  publication: InteractiveFilmPublication | null;
  pending: boolean;
  error: unknown;
  refetching: boolean;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.publish");
  const badgeClass =
    "inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.055] px-2 text-[10px] font-semibold text-white/48";
  if (error) {
    const kind = storyPublicationErrorKind(error);
    const guidance = t(`statusError.${kind}.guidance`);
    const detail = storyApiErrorMessage(error, t("statusError.service.guidance"));
    return (
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`${badgeClass} text-destructive hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-white/55`}
              >
                <IconAlertTriangle className="size-3.5" />
                {t(`statusError.${kind}.label`)}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="block max-w-sm space-y-2 leading-5">
            <p>{guidance}</p>
            <p className="whitespace-pre-wrap break-words">{detail}</p>
            <p>{t("statusError.openDetails")}</p>
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-80 space-y-3 p-4">
          <p className="text-sm font-medium">{guidance}</p>
          <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
          {kind === "auth" ? (
            <Button variant="secondary" onClick={onSignIn}>
              {t("statusError.signIn")}
            </Button>
          ) : null}
          <Button variant="secondary" disabled={refetching} onClick={onRetry}>
            {t(refetching ? "statusChecking" : "retryStatus")}
          </Button>
        </PopoverContent>
      </Popover>
    );
  }
  const badge = (
    <span className={badgeClass} tabIndex={publication?.rejectReason ? 0 : undefined}>
      {publication?.rejectReason ? (
        <IconAlertTriangle className="size-3.5 text-destructive" />
      ) : null}
      {t(`status.${pending ? "checking" : (publication?.status ?? "draft")}`)}
    </span>
  );
  return publication?.rejectReason ? (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="block whitespace-pre-wrap leading-5">
        {t("rejectionReason", { reason: publication.rejectReason })}
      </TooltipContent>
    </Tooltip>
  ) : (
    badge
  );
}
