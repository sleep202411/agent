import { expect, it } from "vitest";
import type { StoryBuildDiagnostic } from "@/lib/story-projects-api";
import { playtestDiagnosticText } from "./playtest-diagnostic-text";

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

function diagnostic(
  overrides: Partial<StoryBuildDiagnostic> & Pick<StoryBuildDiagnostic, "code" | "details">
): StoryBuildDiagnostic {
  return {
    severity: "error",
    message: "media.15: Duplicate stable id video:a1",
    entityType: "revision",
    entityId: null,
    ...overrides,
  };
}

it("names both scenes when playback ids collide", () => {
  const text = playtestDiagnosticText(
    diagnostic({
      code: "STORY_BUILD_INTERMEDIATE_RUNTIME_INVALID",
      details: {
        kind: "duplicate-playback",
        playbackId: "video:a1",
        shots: [
          { sceneTitle: "结局A·孤臣", shotTitle: "夜出京城" },
          { sceneTitle: "沈千户赞许", shotTitle: "沈千户转身赞许" },
        ],
      },
    }),
    t
  );

  expect(text.startsWith("duplicatePlayback:")).toBe(true);
  expect(text).toContain("结局A·孤臣");
  expect(text).toContain("沈千户赞许");
  expect(text).not.toContain("media.15");
  expect(text).not.toContain("STORY_BUILD");
});

it("names the scene and shot when a clip has no video", () => {
  const text = playtestDiagnosticText(
    diagnostic({
      severity: "warning",
      code: "STORY_BUILD_CLIP_MEDIA_REQUIRED",
      message: "Storyboard clip a1 of scene ICB52E_62 has no selected media.",
      entityType: "node",
      entityId: "scene-62",
      details: {
        kind: "shot",
        sceneTitle: "结局·被弃于库",
        shotTitle: "合簿背影",
      },
    }),
    t
  );

  expect(text).toBe('missingShot:{"scene":"结局·被弃于库","shot":"合簿背影"}');
});
