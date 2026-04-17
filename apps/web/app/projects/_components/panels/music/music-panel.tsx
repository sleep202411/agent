"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecord } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { PanelLayout } from "../panel-layout";
import { MusicList } from "./music-list";
import { MusicCreateDialog } from "./music-create-dialog";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { touchAssets, selectCurrentInstance } from "@/src/store/slices/projectSlice";

const MUSIC_SHOT_ID = "-100";
const MUSIC_COLUMN_ID = "-100";

export function MusicPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("music");
  const assetsVersion = useAppSelector((s) => selectCurrentInstance(s).assetsVersion);

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [currentPlayingId, setCurrentPlayingId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setCurrentPlayingId("");
  }, []);

  const loadMusicList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
        data: {
          page: 1,
          pageSize: 50,
          shotId: MUSIC_SHOT_ID,
          shotcolumnId: MUSIC_COLUMN_ID,
          type: "audio",
          sort: 1,
        },
      });
      setRecords(data?.list ?? []);
    } catch (error) {
      console.error("[MusicPanel] load failed:", error);
      toast.error(t("loadListFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadMusicList();
  }, [assetsVersion, loadMusicList]);

  useEffect(() => {
    return () => stopAudio();
  }, [stopAudio]);

  const handlePlay = useCallback(
    (record: AssetRecord) => {
      const src = buildOssUrl(record.path ?? record.filePath ?? record.storagePath ?? record.url);
      const recordId = String(record.id ?? "");
      if (!src || !recordId) return;

      if (currentPlayingId === recordId) {
        stopAudio();
        return;
      }

      stopAudio();
      const audio = new Audio(src);
      audioRef.current = audio;
      audio.onended = () => setCurrentPlayingId("");
      audio.onerror = () => setCurrentPlayingId("");
      void audio
        .play()
        .then(() => setCurrentPlayingId(recordId))
        .catch(() => setCurrentPlayingId(""));
    },
    [currentPlayingId, stopAudio]
  );

  const handleDownload = useCallback((record: AssetRecord) => {
    const src = buildOssUrl(record.path ?? record.filePath ?? record.storagePath ?? record.url);
    if (!src) return;
    const link = document.createElement("a");
    link.href = src;
    link.download = String(record.other ?? record.musicText ?? record.name ?? "").trim() || "music";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleDelete = useCallback(
    async (record: AssetRecord) => {
      const recordId = String(record.id ?? "");
      if (!recordId) return;
      try {
        await backendApi.post(`/api/ai/record/delete/${recordId}`);
        setRecords((prev) => prev.filter((item) => String(item.id ?? "") !== recordId));
        if (currentPlayingId === recordId) stopAudio();
        touchAssets();
      } catch (error) {
        console.error("[MusicPanel] delete failed:", error);
        toast.error(t("deleteFailed"));
      }
    },
    [currentPlayingId, stopAudio, touchAssets, t]
  );

  const handleCreated = useCallback(() => {
    void loadMusicList();
    touchAssets();
  }, [loadMusicList, touchAssets]);

  return (
    <>
      <PanelLayout
        title={t("title")}
        onClose={() => {
          stopAudio();
          onClose();
        }}
        loading={loading}
        footer={
          <Button className="w-full" size="lg" variant="solid" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" />
            {t("createMusic")}
          </Button>
        }
      >
        <MusicList
          records={records}
          currentPlayingId={currentPlayingId}
          onPlay={handlePlay}
          onDownload={handleDownload}
          onDelete={handleDelete}
        />
      </PanelLayout>

      <MusicCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </>
  );
}
