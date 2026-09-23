"use client";

import { useTranslations } from "@/src/i18n/i18n";
import styles from "./tv-catalog-toolbar.module.css";

type CatalogMode = "videos" | "games";

export function TvCatalogToolbar({
  mode,
  onModeChange,
  onCreate,
}: {
  mode: CatalogMode;
  onModeChange: (mode: CatalogMode) => void;
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
      <button type="button" onClick={onCreate} className={styles.create}>
        <span aria-hidden="true" className={styles.plus}>
          +
        </span>
        {channels("create")}
      </button>
    </div>
  );
}
