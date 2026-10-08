"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ExperienceRuntimeState } from "@repo/experience-engine";
import { ExperienceRuntimePlayer } from "@/components/experience-runtime/experience-runtime-player";
import { createNoopPlaySessionReporter } from "../../projects/[projectId]/playtest/_lib/play-session-reporter.noop";
import { isPreviewPlayerPeer, PreviewPlayerCommandSchema } from "./appearance-player-bridge";
import type { z } from "zod/v4";

type Initialization = Extract<
  z.infer<typeof PreviewPlayerCommandSchema>,
  { type: "fizz.preview.initialize" }
>;

/** Contains the same shared player, rather than a second implementation of its UI. */
export function AppearancePlayerWindow({ channel }: { channel: string }) {
  const t = useTranslations("appearancePreview");
  const [input, setInput] = useState<Initialization | null>(null);
  const revision = useRef(0);
  const reporter = useMemo(() => createNoopPlaySessionReporter(), []);
  useEffect(() => {
    if (window.parent === window) return;
    const origin = window.location.origin;
    const listener = (event: MessageEvent) => {
      if (!isPreviewPlayerPeer(event, window.parent, origin)) return;
      const parsed = PreviewPlayerCommandSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.channel !== channel) return;
      const message = parsed.data;
      if (message.type === "fizz.preview.initialize") {
        if (message.revision < revision.current) return;
        revision.current = message.revision;
        setInput((previous) => (previous?.revision === message.revision ? previous : message));
        window.parent.postMessage(
          { type: "fizz.preview.initialized", channel, revision: message.revision },
          origin
        );
      } else if (message.revision === revision.current) {
        setInput((previous) =>
          previous
            ? { ...previous, appearance: message.appearance, gameUi: message.gameUi }
            : previous
        );
      }
    };
    window.addEventListener("message", listener);
    window.parent.postMessage({ type: "fizz.preview.ready", channel }, origin);
    return () => window.removeEventListener("message", listener);
  }, [channel]);
  const reportState = useCallback(
    (state: ExperienceRuntimeState) => {
      window.parent.postMessage(
        {
          type: "fizz.preview.state",
          channel,
          revision: revision.current,
          state: { values: state.values.session, completedEndingIds: state.completedEndingIds },
        },
        window.location.origin
      );
    },
    [channel]
  );
  return (
    <main
      className="relative h-dvh w-full overflow-hidden bg-black text-white"
      data-preview-player-window=""
    >
      {input ? (
        <ExperienceRuntimePlayer
          key={input.revision}
          {...input.config}
          ui={{ apiVersion: 1, appearance: input.appearance, gameUi: input.gameUi }}
          onStateChange={reportState}
          playSessionReporter={reporter}
        />
      ) : (
        <div className="grid h-full place-items-center text-sm text-white/60" role="status">
          {t("playerConnecting")}
        </div>
      )}
    </main>
  );
}
