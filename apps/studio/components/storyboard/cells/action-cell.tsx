"use client";

import { IconPhoto, IconVideo, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ActionCellProps {
  onGenerateImage?: () => void;
  onGenerateVideo?: () => void;
  onDelete: () => void;
}

export function ActionCell({ onGenerateImage, onGenerateVideo, onDelete }: ActionCellProps) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  return (
    <div className="flex items-center justify-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" color="muted" size="icon-xs" onClick={onGenerateImage}>
            <IconPhoto className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("generateImage")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" color="muted" size="icon-xs" onClick={onGenerateVideo}>
            <IconVideo className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("generateVideo")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            color="muted"
            size="icon-xs"
            className="hover:text-destructive"
            onClick={onDelete}
          >
            <IconTrash className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tc("delete")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
