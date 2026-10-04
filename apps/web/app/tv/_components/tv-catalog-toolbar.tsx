"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { IconBolt, IconPlus } from "@tabler/icons-react";
import styles from "./tv-catalog-toolbar.module.css";

type CatalogMode = "videos" | "games";

export function TvCatalogToolbar({
  mode,
  onModeChange,
  onCreate,
  onSubmitVideo,
}: {
  mode: CatalogMode;
  onModeChange: (mode: CatalogMode) => void;
  onCreate: () => void;
  onSubmitVideo?: () => void;
}) {
  const t = useTranslations("tvGames");
  const videoT = useTranslations("communityVideo");
  const channels = useTranslations("channels");
  return (
    <div className={styles.toolbar}>
      <div role="group" aria-label={t("catalog")} className={styles.modes}>
        {(["videos", "games"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
            className={styles.mode}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={onCreate} className={styles.create}>
          <IconBolt aria-hidden="true" className="size-4" />
          {channels("create")}
        </button>
        {onSubmitVideo ? (
          <button
            type="button"
            onClick={onSubmitVideo}
            aria-label={videoT("title")}
            title={videoT("title")}
            className={styles.create}
          >
            <IconPlus aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
