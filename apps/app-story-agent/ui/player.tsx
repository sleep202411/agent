import { useEffect, useMemo, useSyncExternalStore } from "react";
import { QueryObserver } from "@tanstack/react-query";
import {
  ExperiencePlayer,
  loadExperienceTheme,
  type ExperienceThemeLoader,
  type ExperiencePlayerCopy,
} from "@repo/experience-player-react";
import type { StoryPreview } from "@repo/app-story-protocol";
import { StoryTransport, playerCopy } from "./transport";
import { useStoryLocale } from "./preferences";

// Only relocate the packaged built-in theme; preserve the server's integrity hash.
export const loadHostedStoryTheme: ExperienceThemeLoader = (manifest, signal) =>
  loadExperienceTheme(
    {
      ...manifest,
      assets: manifest.assets.map((asset) =>
        asset.kind === "data" && asset.uri === "/experience-runtime/themes/core.film-dark.v1.json"
          ? {
              ...asset,
              uri: new URL(
                "./experience-runtime/themes/core.film-dark.v1.json",
                window.location.href
              ).href,
            }
          : asset
      ),
    },
    signal
  );

/** Render the shared interactive-film runtime inside the App conversation. */
export default function StoryPlayer({ transport }: { transport: StoryTransport }) {
  const observer = useMemo(
    () =>
      new QueryObserver<StoryPreview>(transport.queries, {
        queryKey: ["story-agent-preview", transport.context.projectId, transport.context.chapterId],
        queryFn: ({ signal }) => transport.preview(signal),
      }),
    [transport]
  );
  const subscribe = useMemo(() => observer.subscribe.bind(observer), [observer]);
  const result = useSyncExternalStore(subscribe, () => observer.getCurrentResult());
  useEffect(() => () => observer.destroy(), [observer]);
  const locale = useStoryLocale(transport);
  const t = playerCopy(locale);
  const copy: ExperiencePlayerCopy = {
    ...t,
    unknownEnding: () => t.unknownEnding,
    mediaError: (assetId) => t.mediaError.replace("{assetId}", assetId),
    videoLabel: (nodeId) => t.videoLabel.replace("{nodeId}", nodeId),
    journeyMap: {
      ...t.journeyMap,
      sceneLabel: (number) => t.journeyMap.sceneLabel.replace("{number}", String(number)),
    },
  };
  return (
    <div className="story-player" aria-busy={result.isPending}>
      {result.error && (
        <p role="alert" className="story-error">
          {result.error.message}
        </p>
      )}
      {result.isPending && <p>{t.loadingMedia}</p>}
      {result.data && (
        <ExperiencePlayer
          key={result.data.contentHash}
          runtime={result.data.runtime}
          loadTheme={loadHostedStoryTheme}
          locale={locale}
          coverUrl={result.data.coverUrl ?? undefined}
          frameProfile="auto"
          copy={copy}
        />
      )}
    </div>
  );
}
