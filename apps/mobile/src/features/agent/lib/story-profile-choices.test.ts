import { expect, it } from "vitest";

import { storyProfileOptionLabelKey, storyProfileQuestionCopy } from "./story-profile-choices";

it("localizes the same creative-profile choices the web agent shows", () => {
  expect(storyProfileQuestionCopy("aspect_ratio")?.header).toBe("agent.profile.aspectRatio.header");
  expect(storyProfileOptionLabelKey("aspect_ratio", "landscape_16_9")).toBe(
    "agent.profile.frame.landscape_16_9"
  );
  expect(storyProfileOptionLabelKey("aspect_ratio", "portrait_9_16")).toBe(
    "agent.profile.frame.portrait_9_16"
  );
  expect(storyProfileOptionLabelKey("target_runtime", "short_5_15")).toBe(
    "agent.profile.duration.short_5_15"
  );
  expect(storyProfileOptionLabelKey("visual_direction", "cinematic-realism")).toBe(
    "agent.profile.style.cinematic-realism"
  );
  expect(storyProfileOptionLabelKey("story_language", "zh-CN")).toBeNull();
  expect(storyProfileQuestionCopy("unknown")).toBeNull();
});
