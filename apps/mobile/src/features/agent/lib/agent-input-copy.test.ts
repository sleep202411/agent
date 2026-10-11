import { expect, it, vi } from "vitest";
import { agentInputOptionLabel, agentInputQuestionCopy } from "./agent-input-copy";
import { normalizePendingUserInput } from "../api/agent-os-api";
import en from "@/i18n/messages/en-US.json";
import cn from "@/i18n/messages/zh-CN.json";
import hk from "@/i18n/messages/zh-HK.json";
import type { MessageKey } from "@/i18n";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
const question = {
  id: "visual_direction",
  header: "Server header",
  question: "Server question",
  options: [{ value: "cinematic-realism", label: "Server label" }],
};
it.each([
  ["en-US", en],
  ["zh-CN", cn],
  ["zh-HK", hk],
] as const)(
  "retains the profile marker and resolves fixed copy in %s without changing wire answers",
  (locale, catalog) => {
    const t = (key: MessageKey) => catalog[key];
    const request = normalizePendingUserInput({
      requestId: "request",
      formId: "story_creative_profile",
      questions: [question],
    })!;
    expect(request.formId).toBe("story_creative_profile");
    expect(agentInputQuestionCopy(request.formId, question, t)).toEqual({
      header: catalog["agent.userInputProfile.visual_direction.header"],
      question: catalog["agent.userInputProfile.visual_direction.question"],
    });
    expect(agentInputOptionLabel(request.formId, question.id, question.options[0], locale, t)).toBe(
      catalog["storyProfile.visualStyles.cinematic-realism"]
    );
    expect(
      agentInputOptionLabel(
        request.formId,
        "aspect_ratio",
        { value: "portrait_9_16", label: "server" },
        locale,
        t
      )
    ).toBe(catalog["storyProfile.frameProfiles.portrait_9_16"]);
    expect(
      agentInputOptionLabel(
        request.formId,
        "target_runtime",
        { value: "long_30_60", label: "server" },
        locale,
        t
      )
    ).toBe(catalog["storyProfile.durationPresets.long_30_60"]);
    expect(request.questions[0].options[0].value).toBe("cinematic-realism");
  }
);
it("preserves custom questions, unknown enum choices and malformed language fallbacks", () => {
  const t = (key: MessageKey) => en[key];
  expect(agentInputQuestionCopy("custom", question, t)).toBe(question);
  expect(agentInputOptionLabel("custom", question.id, question.options[0], "en-US", t)).toBe(
    "Server label"
  );
  expect(
    agentInputOptionLabel(
      "story_creative_profile",
      "visual_direction",
      { value: "new-style", label: "New style" },
      "en-US",
      t
    )
  ).toBe("New style");
  expect(
    agentInputOptionLabel(
      "story_creative_profile",
      "story_language",
      { value: "not_a_locale", label: "Original" },
      "en-US",
      t
    )
  ).toBe("Original");
  expect(
    agentInputOptionLabel(
      "story_creative_profile",
      "story_language",
      { value: "fr", label: "server" },
      "en-US",
      t
    )
  ).toBe("French");
});
