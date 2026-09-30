import type { StoryBuildDiagnostic } from "@/lib/story-projects-api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

const SHOT_MESSAGE_KEYS: Record<string, string> = {
  STORY_BUILD_CLIP_MEDIA_REQUIRED: "missingShot",
  STORY_BUILD_VIDEO_CHECKSUM_INVALID: "shotMetadata",
  STORY_BUILD_VIDEO_CONTENT_TYPE_INVALID: "shotUnplayable",
  STORY_BUILD_VIDEO_DURATION_INVALID: "shotMetadata",
  STORY_BUILD_VIDEO_METADATA_INCOMPLETE: "shotMetadata",
  STORY_WORKING_PREVIEW_OUTPUT_MISSING: "shotUnplayable",
  STORY_WORKING_PREVIEW_OUTPUT_INELIGIBLE: "shotUnplayable",
  STORY_WORKING_PREVIEW_OUTPUT_CONTENT_TYPE_INVALID: "shotUnplayable",
  STORY_WORKING_PREVIEW_OUTPUT_METADATA_INCOMPLETE: "shotMetadata",
  STORY_WORKING_PREVIEW_OUTPUT_URL_UNAVAILABLE: "shotUnplayable",
  STORY_WORKING_PREVIEW_MODERATION_PENDING: "shotModeration",
};

export function playtestDiagnosticText(diagnostic: StoryBuildDiagnostic, t: Translate): string {
  const details = diagnostic.details;
  if (
    details?.kind === "state-effect-type" &&
    details.operation === "add" &&
    details.variableType === "boolean" &&
    details.choiceLabel
  ) {
    return t("booleanEffectError", {
      node: details.nodeTitle,
      choice: details.choiceLabel,
      effect: details.effectIndex,
      variable: details.variableName,
    });
  }
  if (details?.kind === "missing-sequence") {
    return t("missingSequence", { scene: details.sceneTitle });
  }
  if (details?.kind === "shot") {
    const key = SHOT_MESSAGE_KEYS[diagnostic.code] ?? "shotUnplayable";
    return t(key, { scene: details.sceneTitle, shot: details.shotTitle });
  }
  if (details?.kind === "duplicate-playback") {
    return t("duplicatePlayback", { shots: joinShots(details.shots, t) });
  }
  return diagnostic.message;
}

function joinShots(
  shots: ReadonlyArray<{ sceneTitle: string; shotTitle: string }>,
  t: Translate
): string {
  const parts = shots.map((shot) =>
    t("shotInScene", { scene: shot.sceneTitle, shot: shot.shotTitle })
  );
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]}${t("shotPairJoiner")}${parts[1]}`;
  return parts.join(t("shotListJoiner"));
}
