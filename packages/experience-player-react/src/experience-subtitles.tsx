"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  ExperienceCoreVideoRendererConfigSchema,
  EXPERIENCE_CORE_VIDEO_RENDERER_ID,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import type { RuntimeSubtitleTrack, StorySubtitleLanguage } from "@repo/shared/story-subtitles";

type SubtitlePreferences = {
  languages: StorySubtitleLanguage[];
  language: StorySubtitleLanguage | "";
  select: (value: StorySubtitleLanguage | "") => void;
};
const SubtitleContext = createContext<SubtitlePreferences>({
  languages: [],
  language: "",
  select: () => undefined,
});

export function ExperienceSubtitlePreferencesProvider({
  manifest,
  locale,
  initialLanguage,
  children,
}: {
  manifest: ExperienceRuntimeManifest;
  locale: string;
  initialLanguage?: StorySubtitleLanguage;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<StorySubtitleLanguage | "" | null>(
    initialLanguage ?? null
  );
  const languages = useMemo(
    () =>
      Array.from(
        new Set(
          manifest.graph.nodes.flatMap((node) =>
            node.kind === "scene"
              ? node.renderers.flatMap((renderer) => {
                  if (renderer.rendererId !== EXPERIENCE_CORE_VIDEO_RENDERER_ID) return [];
                  const parsed = ExperienceCoreVideoRendererConfigSchema.parse(renderer.config);
                  return parsed.sequence.flatMap(
                    (clip) => clip.subtitles?.map((track) => track.language) ?? []
                  );
                })
              : []
          )
        )
      ).sort(),
    [manifest]
  );
  const automatic =
    languages.find((tag) => tag === locale) ??
    languages.find((tag) => tag.split("-")[0] === locale.split("-")[0]) ??
    "";
  return (
    <SubtitleContext.Provider
      value={{ languages, language: selection ?? automatic, select: setSelection }}
    >
      {children}
    </SubtitleContext.Provider>
  );
}

function activeSubtitleCues(
  tracks: readonly RuntimeSubtitleTrack[],
  language: string,
  positionMs: number
) {
  return (
    tracks
      .find((track) => track.language === language)
      ?.cues.filter((cue) => cue.startMs <= positionMs && positionMs < cue.endMs) ?? []
  );
}

export function ExperienceSubtitleLayer({
  tracks,
  positionMs,
  visible,
  copy,
}: {
  tracks: readonly RuntimeSubtitleTrack[];
  positionMs: number;
  visible: boolean;
  copy: { label: string; off: string; languages: Record<StorySubtitleLanguage, string> };
}) {
  const preferences = useContext(SubtitleContext);
  if (!preferences.languages.length) return null;
  const cues = visible ? activeSubtitleCues(tracks, preferences.language, positionMs) : [];
  return (
    <>
      <div
        className="absolute top-3 left-3"
        data-experience-ui-region="subtitles"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <select
          aria-label={copy.label}
          value={preferences.language}
          onChange={(event) => preferences.select(event.target.value as StorySubtitleLanguage | "")}
          className="max-w-44 cursor-pointer rounded-lg bg-black/65 px-3 py-2 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <option value="">{copy.off}</option>
          {preferences.languages.map((language) => (
            <option key={language} value={language}>
              {copy.languages[language]}
            </option>
          ))}
        </select>
      </div>
      <div
        data-experience-subtitles=""
        className="pointer-events-none absolute inset-x-4 bottom-20 flex flex-col items-center gap-1 text-center"
      >
        {cues.map((cue, index) => (
          <p
            key={index}
            dir="auto"
            className="max-w-[85%] whitespace-pre-line rounded bg-black/75 px-3 py-1 text-[clamp(14px,2.4cqw,22px)] leading-snug text-white"
          >
            {cue.text}
          </p>
        ))}
      </div>
    </>
  );
}
