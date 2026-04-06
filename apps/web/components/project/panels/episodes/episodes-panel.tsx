"use client";

import { useMemo, useState } from "react";
import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
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

  const currentEpisode = useMemo(
    () => episodes.find((episode) => String(episode.id) === String(activeEpisodeId)),
    [activeEpisodeId, episodes]
  );
  const totalDuration = useMemo(() => getDurationFromRows(rows), [rows]);
  const totalShots = rows.length;

  const handleCreated = (episodeId: string, title?: string) => {
    store.dispatch(addEpisodeToStore({ id: episodeId, title: title ?? "" } as Episode));
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
