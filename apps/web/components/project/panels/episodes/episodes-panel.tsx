import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLoader2, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { backendApi } from "@/src/lib/api";
import { PanelLayout } from "../panel-layout";
import { EpisodeList } from "./episode-list";
import { EpisodeCreateDialog } from "./episode-create-dialog";
import { EpisodeEditDialog } from "./episode-edit-dialog";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  addEpisodeToStore,
  setActiveEpisodeId,
  setEpisodes,
  removeEpisodeFromStore,
  selectCurrentInstance,
  type Episode,
  type ShotRow,
} from "@/src/store/slices/projectSlice";

function getDurationFromRows(rows: ShotRow[]) {
  return rows.reduce((total, row) => {
    const durationValue = row.shotValues?.find((value) => value.presetColumnKey === "duration");
    const numericValue = Number(durationValue?.value ?? durationValue?.richText?.content ?? 0);
    return total + (Number.isFinite(numericValue) ? numericValue : 0);
  }, 0);
}

export function EpisodesPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("episode");
  const tc = useTranslations("common");
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const episodes = useAppSelector((s) => selectCurrentInstance(s).episodes);
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isEpisodesLoading);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [deletingEpisode, setDeletingEpisode] = useState<Episode | null>(null);
  const [deleting, setDeleting] = useState(false);

  const dispatch = useAppDispatch();

  // Silent refresh when panel opens (if data exists)
  const refreshEpisodes = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await backendApi.post<{ list?: Episode[] }>("/api/user/world/list/episode", {
        data: { productId: projectId, page: 1, pageSize: 999 },
      });
      if (!data?.list) return;

      const list = data.list;
      store.dispatch(setEpisodes(list));

      // Fix sort values: any zero, duplicates, or out-of-order
      const sorts = list.map((ep) => ep.sort ?? 0);
      const hasZero = sorts.some((s) => s === 0);
      const hasDuplicates = new Set(sorts).size !== sorts.length;
      if (list.length > 1 && (hasZero || hasDuplicates)) {
        const SORT_GAP = 1024;
        const datas = list.map((ep, i) => ({
          id: String(ep.id),
          title: String(ep.title ?? ""),
          sort: (i + 1) * SORT_GAP,
          projectId,
        }));
        await backendApi
          .post("/api/user/world/batch/updateOrAdd/episode", {
            data: { datas },
          })
          .catch(() => {});
        store.dispatch(setEpisodes(list.map((ep, i) => ({ ...ep, sort: (i + 1) * SORT_GAP }))));
      }
    } catch {
      // silent fail
    }
  }, [projectId]);

  useEffect(() => {
    if (episodes.length > 0) {
      void refreshEpisodes();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentEpisode = useMemo(
    () => episodes.find((episode) => String(episode.id) === String(activeEpisodeId)),
    [activeEpisodeId, episodes]
  );
  const totalDuration = useMemo(() => getDurationFromRows(rows), [rows]);
  const totalShots = rows.length;

  const handleReorder = useCallback(
    async (reordered: Episode[]) => {
      if (!projectId) return;
      // Optimistic update
      store.dispatch(setEpisodes(reordered));
      // Persist with new sort values
      const SORT_GAP = 1024;
      const datas = reordered.map((ep, i) => ({
        id: String(ep.id),
        title: String(ep.title ?? ""),
        sort: (i + 1) * SORT_GAP,
        projectId,
      }));
      try {
        await backendApi.post("/api/user/world/batch/updateOrAdd/episode", {
          data: { datas },
        });
      } catch (error) {
        console.error("[EpisodesPanel] reorder failed:", error);
        toast.error(tc("saveFailed"));
        void refreshEpisodes();
      }
    },
    [projectId, refreshEpisodes, tc]
  );

  const handleCreated = (episodeId: string, title?: string) => {
    // Compute sort for the new episode: after the last one
    const maxSort = episodes.reduce((max, ep) => Math.max(max, ep.sort ?? 0), 0);
    store.dispatch(
      addEpisodeToStore({ id: episodeId, title: title ?? "", sort: maxSort + 1024 } as Episode)
    );
    store.dispatch(setActiveEpisodeId(episodeId));
  };

  const handleDeleteEpisode = async () => {
    const target = deletingEpisode;
    const episodeId = String(target?.id ?? "");
    if (!target || !episodeId) return;

    setDeleting(true);
    try {
      await backendApi.post(`/api/user/world/delete/episode?id=${episodeId}`);
      store.dispatch(removeEpisodeFromStore(episodeId));
      toast.success(t("episodeDeleted"));

      if (String(activeEpisodeId) === episodeId) {
        const remaining = episodes.filter((ep) => String(ep.id) !== episodeId);
        if (remaining[0]?.id) store.dispatch(setActiveEpisodeId(String(remaining[0].id)));
      }

      setDeletingEpisode(null);
    } catch (error) {
      console.error("[EpisodesPanel] 删除剧集失败:", error);
      toast.error(t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={onClose}
        loading={isLoading}
        actions={
          <button
            type="button"
            onClick={() => void refreshEpisodes()}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={tc("refresh")}
          >
            <IconRefresh className="size-3.5" />
          </button>
        }
        footer={
          <Button className="w-full" size="lg" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" />
            {t("addEpisode")}
          </Button>
        }
      >
        <EpisodeList
          episodes={episodes}
          activeEpisodeId={activeEpisodeId}
          onSelect={(id) => store.dispatch(setActiveEpisodeId(id))}
          onEdit={(ep) => setEditingEpisode(ep)}
          onDelete={(ep) => setDeletingEpisode(ep)}
          onReorder={handleReorder}
        />
      </PanelLayout>

      <EpisodeCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {editingEpisode && (
        <EpisodeEditDialog
          open={!!editingEpisode}
          onOpenChange={(open) => !open && setEditingEpisode(null)}
          episode={editingEpisode}
          onSaved={() => setEditingEpisode(null)}
        />
      )}

      <AlertDialog
        open={!!deletingEpisode}
        onOpenChange={(open) => !open && setDeletingEpisode(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteEpisode")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteEpisodeConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="soft"
              color="destructive"
              onClick={() => void handleDeleteEpisode()}
              disabled={deleting}
            >
              {deleting && <IconLoader2 className="size-3.5 animate-spin" />}
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
