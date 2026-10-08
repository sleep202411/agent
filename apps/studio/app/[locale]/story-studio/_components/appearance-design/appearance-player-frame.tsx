"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ExperienceAppearance, GameUIArtifact } from "@repo/shared/experience-runtime";
import type { StoryFrameProfile } from "@/lib/story-projects-api";
import {
  isPreviewPlayerPeer,
  PreviewPlayerEventSchema,
  type PreviewPlayerState,
} from "./appearance-player-bridge";
import styles from "./appearance-preview.module.css";

export interface AppearancePlayerFrameProps {
  runtime: Record<string, unknown>;
  locale: string;
  appearance: ExperienceAppearance;
  gameUi?: GameUIArtifact | null;
  frameProfile?: StoryFrameProfile;
  coverUrl?: string | null;
  startSceneId?: string | null;
  onPreviewStateChange?: (state: PreviewPlayerState) => void;
}

/** A real browser viewport: player portals, focus, CSS breakpoints and shortcuts stay inside. */
export function AppearancePlayerFrame({
  appearance,
  gameUi,
  onPreviewStateChange,
  ...player
}: AppearancePlayerFrameProps) {
  const channel = useId();
  const t = useTranslations("appearancePreview");
  const frame = useRef<HTMLIFrameElement>(null);
  const lastAppearance = useRef<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const { runtime, locale, frameProfile, coverUrl, startSceneId } = player;
  const config = useMemo(
    () => ({ runtime, locale, frameProfile, coverUrl, startSceneId }),
    [runtime, locale, frameProfile, coverUrl, startSceneId]
  );
  const current = useRef({ config, appearance, gameUi, revision: 1, onPreviewStateChange });
  useLayoutEffect(() => {
    const previous = current.current;
    current.current = {
      config,
      appearance,
      gameUi,
      onPreviewStateChange,
      revision: previous.revision + Number(previous.config !== config),
    };
  }, [config, appearance, gameUi, onPreviewStateChange]);
  const initialize = useCallback(() => {
    const { config, appearance, gameUi, revision } = current.current;
    frame.current?.contentWindow?.postMessage(
      { type: "fizz.preview.initialize", channel, revision, config, appearance, gameUi },
      window.location.origin
    );
  }, [channel]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setFailed(true), 20_000);
    const listener = (event: MessageEvent) => {
      if (!isPreviewPlayerPeer(event, frame.current?.contentWindow ?? null, window.location.origin))
        return;
      const result = PreviewPlayerEventSchema.safeParse(event.data);
      if (!result.success || result.data.channel !== channel) return;
      const message = result.data;
      if (message.type === "fizz.preview.ready") initialize();
      else if (message.revision === current.current.revision) {
        if (message.type === "fizz.preview.initialized") {
          window.clearTimeout(timeout);
          setConnected(true);
          setFailed(false);
        } else current.current.onPreviewStateChange?.(message.state);
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      window.clearTimeout(timeout);
    };
  }, [channel, generation, initialize]);
  useEffect(() => {
    initialize();
  }, [config, initialize]);
  useEffect(() => {
    const serial = JSON.stringify({ appearance, gameUi });
    // Chat draft updates may recreate equal objects; they must not update the player.
    if (lastAppearance.current === serial) return;
    lastAppearance.current = serial;
    frame.current?.contentWindow?.postMessage(
      {
        type: "fizz.preview.appearance",
        channel,
        revision: current.current.revision,
        appearance,
        gameUi,
      },
      window.location.origin
    );
  }, [appearance, gameUi, channel]);
  return (
    <div className={styles.playerWindow}>
      <iframe
        key={generation}
        ref={frame}
        title={t("playerWindow")}
        data-preview-player-frame=""
        className={styles.playerFrame}
        src={`/${locale}/story-studio/preview-player?channel=${encodeURIComponent(channel)}`}
        allow="autoplay; fullscreen 'none'"
        onLoad={initialize}
      />
      {!connected && (
        <div className={styles.playerConnection} role={failed ? "alert" : "status"}>
          <p>{t(failed ? "playerFailed" : "playerConnecting")}</p>
          {failed && (
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setConnected(false);
                setGeneration((value) => value + 1);
              }}
            >
              {t("playerRetry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
