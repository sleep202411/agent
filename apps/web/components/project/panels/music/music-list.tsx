"use client";

import { IconMusic } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { AssetRecord } from "@/src/types/workspace";
import { MusicCard } from "./music-card";

function resolveMusicTitle(record: AssetRecord, fallback: string) {
  return String(record.other ?? record.musicText ?? record.name ?? "").trim() || fallback;
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return (
    date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }) +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

interface MusicListProps {
  records: AssetRecord[];
  currentPlayingId: string;
  onPlay: (record: AssetRecord) => void;
  onDownload: (record: AssetRecord) => void;
  onDelete: (record: AssetRecord) => void;
}

export function MusicList({
  records,
  currentPlayingId,
  onPlay,
  onDownload,
  onDelete,
}: MusicListProps) {
  const t = useTranslations("music");

  if (records.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <IconMusic className="size-10 text-muted-foreground/20" />
        <p className="text-xs text-muted-foreground">{t("noRecords")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {records.map((record) => {
        const recordId = String(record.id ?? "");
        return (
          <MusicCard
            key={recordId || String(record.path ?? record.filePath ?? "")}
            title={resolveMusicTitle(record, t("unnamedMusic"))}
            time={formatTime(record.createTime)}
            playing={currentPlayingId === recordId}
            onPlay={() => onPlay(record)}
            onDownload={() => onDownload(record)}
            onDelete={() => onDelete(record)}
          />
        );
      })}
    </div>
  );
}
