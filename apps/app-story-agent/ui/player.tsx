import { useEffect, useMemo, useSyncExternalStore } from "react";
import { QueryObserver } from "@tanstack/react-query";
import { ExperiencePlayer, type ExperiencePlayerCopy } from "@repo/experience-player-react";
import type { StoryPreview } from "@repo/app-story-protocol";
import { StoryTransport, playerCopy } from "./transport";

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
  const t = playerCopy(transport.context.locale);
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
          locale={transport.context.locale}
          coverUrl={result.data.coverUrl ?? undefined}
          frameProfile="auto"
          copy={copy}
        />
      )}
    </div>
  );
}
