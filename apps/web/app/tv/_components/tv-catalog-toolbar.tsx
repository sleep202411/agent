"use client";

import { useTranslations } from "@/src/i18n/i18n";
import styles from "./tv-catalog-toolbar.module.css";

type ChannelType = "ip" | "community";
type CatalogMode = "videos" | "games";

export function TvCatalogToolbar({
  mode,
  channelType,
  onModeChange,
  onChannelChange,
  onCreate,
}: {
  mode: CatalogMode;
  channelType: ChannelType;
  onModeChange: (mode: CatalogMode) => void;
  onChannelChange: (category: ChannelType) => void;
  onCreate: () => void;
}) {
  const t = useTranslations("tvGames");
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
      {mode === "videos" && (
        <div role="group" aria-label={channels("category")} className={styles.categories}>
          {(["ip", "community"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={channelType === value}
              onClick={() => onChannelChange(value)}
              className={styles.category}
            >
              {channels(value)}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={onCreate} className={styles.create}>
        <span aria-hidden="true" className={styles.plus}>
          +
        </span>
        {channels("create")}
      </button>
    </div>
  );
}
