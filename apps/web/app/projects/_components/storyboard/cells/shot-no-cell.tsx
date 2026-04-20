"use client";

import { useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconLoader2, IconRowInsertBottom, IconRowInsertTop, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
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
import { backendApi } from "@/src/lib/api";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { setRows, selectCurrentInstance, type ShotRow } from "@/src/store/slices/projectSlice";

export function ShotNoCell({ row, rowIndex }: { row: ShotRow; rowIndex: number }) {
  const t = useTranslations("storyboard");
  const tc = useTranslations("common");
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const storyBoardId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const [hovered, setHovered] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [inserting, setInserting] = useState<"before" | "after" | null>(null);

  const shotId = String(row.shotId ?? "");
  const suffix = shotId ? shotId.slice(-6) : "new";

  const handleInsert = async (position: "before" | "after") => {
    if (!projectId || !storyBoardId || inserting) return;
    setInserting(position);
    try {
      let beforeTheShotId: string | undefined;
      if (position === "before") {
        beforeTheShotId = shotId || undefined;
      } else {
        beforeTheShotId = rows[rowIndex + 1]?.shotId
          ? String(rows[rowIndex + 1].shotId)
          : undefined;
      }
      const result = await backendApi.post<string | number>("/api/user/shot/create", {
        data: { projectId, storyBoardId, beforeTheShotId, enable: true },
      });
      const newShotId = String(result ?? "");
      if (newShotId) {
        const newRow: ShotRow = { shotId: newShotId, shotValues: [] };
        const insertIndex = position === "before" ? rowIndex : rowIndex + 1;
        const nextRows = [...selectCurrentInstance(store.getState()).rows];
        nextRows.splice(insertIndex, 0, newRow);
        store.dispatch(setRows(nextRows));
      }
      toast.success(t("insertedEmptyShot"));
    } catch (error) {
      console.error("[ShotNoCell] create shot failed:", error);
      toast.error(t("createShotFailed"));
    } finally {
      setInserting(null);
    }
  };

  const handleDelete = async () => {
    if (!shotId) return;
    const prevRows = selectCurrentInstance(store.getState()).rows;
    store.dispatch(setRows(prevRows.filter((r) => String(r.shotId) !== shotId)));
    try {
      await backendApi.post(`/api/user/shot/delete/${shotId}`);
    } catch (error) {
      console.error("[ShotNoCell] delete shot failed:", error);
      toast.error(t("deleteShotFailed"));
      store.dispatch(setRows(prevRows));
    }
  };

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
                    onClick={() => void handleInsert("before")}
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
                    onClick={() => void handleInsert("after")}
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
            <AlertDialogAction
              variant="solid"
              color="destructive"
              onClick={() => void handleDelete()}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
