"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { backendApi } from "@/src/lib/api";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import { setRows, selectCurrentInstance, type ShotRow } from "@/src/store/slices/projectSlice";

/**
 * Per-row action helpers shared by the table view's shot-no-cell and the
 * card view's per-card action menu. Encapsulates the insert / delete
 * Java endpoint calls plus the optimistic redux updates that pair with
 * them, so both views stay in sync without duplicating logic.
 */
export function useShotRowActions(row: ShotRow, rowIndex: number) {
  const t = useTranslations("storyboard");
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const storyBoardId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const [inserting, setInserting] = useState<"before" | "after" | null>(null);

  const shotId = String(row.shotId ?? "");
  const canAct = Boolean(projectId && storyBoardId);

  const insert = async (position: "before" | "after") => {
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
      console.error("[useShotRowActions] create shot failed:", error);
      toast.error(t("createShotFailed"));
    } finally {
      setInserting(null);
    }
  };

  const remove = async () => {
    if (!shotId) return;
    const prevRows = selectCurrentInstance(store.getState()).rows;
    store.dispatch(setRows(prevRows.filter((r) => String(r.shotId) !== shotId)));
    try {
      await backendApi.post(`/api/user/shot/delete/${shotId}`);
    } catch (error) {
      console.error("[useShotRowActions] delete shot failed:", error);
      toast.error(t("deleteShotFailed"));
      store.dispatch(setRows(prevRows));
    }
  };

  return { insert, remove, inserting, shotId, canAct };
}
