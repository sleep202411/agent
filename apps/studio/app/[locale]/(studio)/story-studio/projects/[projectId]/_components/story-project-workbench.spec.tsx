// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryOverviewCreativeProfile } from "./story-project-workbench";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

describe("StoryOverviewCreativeProfile", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders every project-level creative constraint on the real Overview route", async () => {
    await act(async () => {
      root.render(
        <StoryOverviewCreativeProfile
          project={{
            frameProfile: "landscape_16_9",
            durationPreset: "medium_15_30",
            visualStyle: "graphic-novel-cinema",
            defaultLocale: "en-US",
          }}
        />
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("aspectRatio");
    expect(text).toContain("frameProfiles.landscape_16_9");
    expect(text).toContain("targetRuntime");
    expect(text).toContain("durationPresets.medium_15_30");
    expect(text).toContain("visualStyle");
    expect(text).toContain("visualStyles.graphic-novel-cinema");
    expect(text).toContain("language");
    expect(text).toContain("en-US");
  });
});
