"use client";

import { useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2, IconRowInsertBottom, IconRowInsertTop, IconTrash } from "@tabler/icons-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type ShotRow } from "@/src/store/slices/projectSlice";
import { useShotRowActions } from "../use-shot-row-actions";

export function ShotNoCell({ row, rowIndex }: { row: ShotRow; rowIndex: number }) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const { insert, remove, inserting, shotId } = useShotRowActions(row, rowIndex);
  const [hovered, setHovered] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const suffix = shotId ? shotId.slice(-6) : "new";

  return (
    <>
      <div
        className="relative flex h-full w-full items-center justify-center"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hovered ? (
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-col items-center gap-1 rounded-lg bg-background/90 p-2 shadow-lg">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    disabled={!!inserting}
                    onClick={() => void insert("before")}
                  >
                    {inserting === "before" ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRowInsertTop className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("insertAbove")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    disabled={!!inserting}
                    onClick={() => setDeleteOpen(true)}
                  >
                    <IconTrash className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{tc("delete")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    color="muted"
                    size="icon-xs"
                    disabled={!!inserting}
                    onClick={() => void insert("after")}
                  >
                    {inserting === "after" ? (
                      <IconLoader2 className="size-3.5 animate-spin" />
                    ) : (
                      <IconRowInsertBottom className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{t("insertBelow")}</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-semibold text-muted-foreground">#{rowIndex + 1}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">{suffix}</span>
          </div>
        )}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc("confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDeleteShot")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="solid" color="destructive" onClick={() => void remove()}>
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
