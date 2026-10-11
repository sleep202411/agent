import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { StoryCreativeProfileSummary, type StoryCreativeProfile } from "./story-creative-profile";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
async function render(profile: StoryCreativeProfile) {
  const host = document.createElement("div"),
    root = createRoot(host);
  await act(async () => root.render(<StoryCreativeProfileSummary profile={profile} />));
  const text = host.textContent;
  expect(host.querySelector("input,button")).toBeNull();
  await act(async () => root.unmount());
  return text;
}
it("shows all project constraints as read-only values", async () => {
  const text = await render({
    frameProfile: "portrait_9_16",
    durationPreset: "medium_15_30",
    visualStyle: "ink-wash-cinema",
    defaultLocale: "zh-CN",
  });
  expect(text).toContain("storyProfile.frameProfiles.portrait_9_16");
  expect(text).toContain("storyProfile.durationPresets.medium_15_30");
  expect(text).toContain("storyProfile.visualStyles.ink-wash-cinema");
  expect(text).toContain("zh-CN");
});
it("does not invent defaults for unset or new server values", async () => {
  const text = await render({
    durationPreset: null,
    visualStyle: "new-style",
    defaultLocale: "en-US",
  });
  expect(text).toContain("storyProfile.notSet");
  expect(text).toContain("new-style");
  expect(text).not.toContain("landscape_16_9");
});
it("retains the language tag when Intl cannot describe it", async () => {
  const text = await render({ defaultLocale: "invalid_tag" });
  expect(text).toContain("invalid_tag");
});
