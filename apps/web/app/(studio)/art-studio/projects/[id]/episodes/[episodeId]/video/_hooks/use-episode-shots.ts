"use client";

/**
 * Loads + owns the editor's working state for a single episode:
 * shot-table columns, rows, world-scoped asset roster, and the
 * currently selected shot. Encapsulates the `loadProduceStoryboard`
 * + `loadProduceJavaAssets` parallel fetch so the page component
 * stays focused on layout.
 *
 * Returns a `reload()` callback so child components (after a save
 * / regen) can refresh without lifting that knowledge into the
 * page.
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadProduceJavaAssets,
  loadProduceStoryboard,
  loadProjectWorldId,
  type ProduceJavaAssetLists,
  type ProduceShotColumn,
} from "@/src/lib/produce/java-produce-data";
import type { ShotRow } from "@/src/store/slices/projectSlice";
import { EMPTY_ASSETS } from "../_lib/shot-helpers";

interface UseEpisodeShotsArgs {
  projectId: string;
  episodeId: string;
  /** worldId from URL search params, if present. Wins over
   *  fallbacks because it's the freshest hint from the navigator. */
  queryWorldId?: string;
  /** worldId from a previously-committed pipeline result; used
   *  only when the URL doesn't carry it. */
  committedWorldId?: string;
}

export interface UseEpisodeShotsResult {
  columns: ProduceShotColumn[];
  rows: ShotRow[];
  assets: ProduceJavaAssetLists;
  selectedShotId: string;
  setSelectedShotId: (shotId: string) => void;
  setRows: React.Dispatch<React.SetStateAction<ShotRow[]>>;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

export function useEpisodeShots({
  projectId,
  episodeId,
  queryWorldId,
  committedWorldId,
}: UseEpisodeShotsArgs): UseEpisodeShotsResult {
  const [columns, setColumns] = useState<ProduceShotColumn[]>([]);
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [assets, setAssets] = useState<ProduceJavaAssetLists>(EMPTY_ASSETS);
  const [selectedShotId, setSelectedShotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!projectId || !episodeId) return;
    setLoading(true);
    setError("");
    try {
      const resolvedWorldId =
        queryWorldId || committedWorldId || (await loadProjectWorldId(projectId));
      const [{ columns: nextColumns, rows: nextRows }, nextAssets] = await Promise.all([
        loadProduceStoryboard(episodeId),
        resolvedWorldId ? loadProduceJavaAssets(resolvedWorldId) : Promise.resolve(EMPTY_ASSETS),
      ]);
      setColumns(nextColumns);
      setRows(nextRows);
      // Keep the user's selected shot if it still exists; otherwise
      // jump to the first row.
      setSelectedShotId((current) =>
        current && nextRows.some((row) => String(row.shotId ?? "") === current)
          ? current
          : String(nextRows[0]?.shotId ?? "")
      );
      setAssets(nextAssets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载分镜失败");
      setColumns([]);
      setRows([]);
      setAssets(EMPTY_ASSETS);
    } finally {
      setLoading(false);
    }
  }, [committedWorldId, episodeId, projectId, queryWorldId]);

  useEffect(() => {
    // Defer one frame so route params have a chance to settle when
    // the page first mounts. Without this, fast navs occasionally
    // fired the fetch with stale ids.
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return {
    columns,
    rows,
    assets,
    selectedShotId,
    setSelectedShotId,
    setRows,
    loading,
    error,
    reload,
  };
}
