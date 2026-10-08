"use client";
import { useSyncExternalStore } from "react";
import { IconPlayerPlay, IconRoute } from "@tabler/icons-react";
import type { ExperienceMainMenuUIProps } from "./experience-ui";
import styles from "./experience-main-menu.module.css";

export function ExperienceDefaultMainMenuUI({
  title,
  summary,
  eyebrow,
  session,
  copy,
}: ExperienceMainMenuUIProps) {
  const game = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const action = game.status === "completed" ? "restart" : game.started ? "continue" : "start";
  const label =
    game.status === "starting"
      ? copy.starting
      : game.status === "loading"
        ? copy.loading
        : copy[action];
  return (
    <div data-ui-part="panel" className={styles.panel}>
      {eyebrow && (
        <p data-ui-part="eyebrow" className={styles.eyebrow}>
          {eyebrow}
        </p>
      )}
      <h1 data-ui-part="title" className={styles.title}>
        {title}
      </h1>
      {summary && (
        <p data-ui-part="summary" className={styles.summary}>
          {summary}
        </p>
      )}
      <button
        type="button"
        data-ui-part="primary"
        data-game-action={action}
        className={styles.primary}
        disabled={!game.actions[action]}
        onClick={() => {
          void session.invoke(action);
        }}
      >
        <IconPlayerPlay size={20} aria-hidden="true" />
        {label}
      </button>
      <button
        type="button"
        data-ui-part="secondary"
        data-game-action="open-map"
        aria-haspopup="dialog"
        className={styles.secondary}
        disabled={!game.actions["open-map"]}
        onClick={() => {
          void session.invoke("open-map");
        }}
      >
        <IconRoute size={20} aria-hidden="true" />
        {copy.map}
      </button>
    </div>
  );
}
