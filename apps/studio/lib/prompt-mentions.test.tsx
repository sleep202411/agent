// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReferenceMediaHoverPreview,
  formatMediaPreviewBytes,
  formatMediaPreviewDuration,
  insertMentionText,
  MentionChip,
  MentionMenu,
  mentionCandidates,
  mentionVisibleCount,
  SkillMentionDialog,
  type MentionItem,
} from "./prompt-mentions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("MentionChip", () => {
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

  it("keeps media references pill-shaped while only replacing the violet palette", async () => {
    await act(async () => {
      root.render(
        <div>
          <MentionChip
            mention={{ id: "skill-1", kind: "skill", label: "CinematicLighting" }}
            text="/CinematicLighting"
          />
          <MentionChip mention={{ id: "image-1", kind: "image", label: "Image1" }} text="@Image1" />
        </div>
      );
    });

    const skill = container.querySelector<HTMLElement>('[data-mention-kind="skill"]');
    const image = container.querySelector<HTMLElement>('[data-mention-kind="image"]');

    expect(skill?.classList.contains("rounded-md")).toBe(true);
    expect(skill?.classList.contains("bg-transparent")).toBe(true);
    expect(skill?.classList.contains("ring-brand-yellow/30")).toBe(true);
    expect(skill?.classList.contains("text-brand-yellow/85")).toBe(true);
    expect(skill?.classList.contains("bg-white/[0.065]")).toBe(false);
    expect(skill?.classList.contains("bg-violet-500/25")).toBe(false);
    expect(image?.classList.contains("rounded-full")).toBe(true);
    expect(image?.classList.contains("bg-white/[0.085]")).toBe(true);
    expect(image?.className).toContain("shadow-[inset_0_1px_0");
    expect(image?.className).not.toContain("rounded-md");
    expect(image?.className).not.toContain("brand-blue");
    expect(image?.className).not.toContain("violet");
  });

  it("inserts Skills with slash while keeping media references on at-sign", () => {
    expect(
      insertMentionText("Create /cin", 11, {
        kind: "skill",
        label: "CinematicLighting",
      })
    ).toEqual({
      value: "Create /CinematicLighting ",
      caret: 26,
    });
    expect(insertMentionText("Use @ima", 8, { kind: "image", label: "Image1" })).toEqual({
      value: "Use @Image1 ",
      caret: 12,
    });
  });

  it("formats and renders available media facts below the hover preview", async () => {
    expect(formatMediaPreviewDuration(65)).toBe("1:05");
    expect(formatMediaPreviewBytes(2_097_152)).toBe("2.0 MB");

    await act(async () => {
      root.render(
        <ReferenceMediaHoverPreview
          item={{
            kind: "video",
            label: "Video1",
            name: "Reference clip",
            previewUrl: "/reference.mp4",
            durationSeconds: 5,
            bytes: 2_097_152,
            width: 1920,
            height: 1080,
          }}
          style={{ left: 20, top: 20 }}
        />
      );
    });

    const metadata = document.body.querySelector("[data-reference-preview-metadata]");
    expect(metadata?.textContent).toContain("Reference clip");
    expect(metadata?.textContent).toContain("5s");
    expect(metadata?.textContent).toContain("1920×1080");
    expect(metadata?.textContent).toContain("2.0 MB");
  });

  it("uses Skill cover media in the slash menu without repeating the name", async () => {
    await act(async () => {
      root.render(
        <MentionMenu
          active={0}
          emptyKind="skill"
          onPick={vi.fn()}
          options={[
            {
              id: "skill-video",
              kind: "skill",
              label: "Micro Expression Director",
              name: "Micro Expression Director",
              previewUrl: "/skills/micro-expression.jpg",
              previewVideoUrl: "/skills/micro-expression.mp4",
            },
            {
              id: "skill-image",
              kind: "skill",
              label: "Wes Anderson Aesthetic",
              name: "Wes Anderson Aesthetic",
              previewUrl: "/skills/wes-anderson.jpg",
            },
          ]}
        />
      );
    });

    const video = container.querySelector<HTMLVideoElement>("video");
    const image = container.querySelector<HTMLImageElement>("img");
    expect(video?.getAttribute("src")).toBe("/skills/micro-expression.mp4");
    expect(video?.getAttribute("poster")).toBe("/skills/micro-expression.jpg");
    expect(image?.getAttribute("src")).toBe("/skills/wes-anderson.jpg");
    expect(container.textContent?.match(/Micro Expression Director/g)).toHaveLength(1);
    expect(container.textContent).not.toContain("/Micro Expression Director");
  });

  it("caps the quick Skill menu at eight and exposes the full browser", async () => {
    const onShowAll = vi.fn();
    await act(async () => {
      root.render(
        <MentionMenu
          active={0}
          emptyKind="skill"
          onPick={vi.fn()}
          onShowAll={onShowAll}
          options={Array.from({ length: 9 }, (_, index) => ({
            id: `skill-${index + 1}`,
            kind: "skill" as const,
            label: `Skill ${index + 1}`,
          }))}
        />
      );
    });

    expect(container.textContent).toContain("Skill 8");
    expect(container.textContent).not.toContain("Skill 9");
    const showAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "showAllSkills"
    );
    expect(showAll).toBeDefined();
    await act(async () => {
      showAll?.click();
    });
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("renders every attached reference — the menu scrolls instead of truncating", async () => {
    await act(async () => {
      root.render(
        <MentionMenu
          active={12}
          onPick={vi.fn()}
          options={Array.from({ length: 13 }, (_, index) => ({
            id: `image-${index + 1}`,
            kind: "image" as const,
            label: `Image${index + 1}`,
          }))}
        />
      );
    });

    // Regression: a UI-side cap once hid Image11+ even though the model
    // policy (Seedance 2.5 referenceInputs) allows 30 images / 50 files.
    expect(container.querySelectorAll("[data-mention-row]")).toHaveLength(13);
    expect(container.textContent).toContain("Image13");
    expect(container.textContent).not.toContain("showAllSkills");
  });

  it("separates installed Skills from the real market and routes uninstalled items", async () => {
    const onOpenMarket = vi.fn();
    const onPick = vi.fn();
    await act(async () => {
      root.render(
        <SkillMentionDialog
          open
          options={[{ id: "installed-1", kind: "skill", label: "Installed Skill" }]}
          marketOptions={[
            {
              id: "catalog:market-1",
              catalogId: "market-1",
              installed: false,
              kind: "skill",
              label: "Market Skill",
            },
            {
              id: "installed-1",
              catalogId: "market-2",
              installed: true,
              kind: "skill",
              label: "Installed Market Skill",
            },
          ]}
          onOpenChange={vi.fn()}
          onOpenMarket={onOpenMarket}
          onPick={onPick}
        />
      );
    });

    const skillGrid = document.querySelector<HTMLElement>('[data-testid="skill-browser-grid"]');
    const skillTitle = document.querySelector<HTMLElement>(
      '[data-testid="skill-browser-card-title"]'
    );
    expect(skillGrid?.className).toContain("lg:grid-cols-5");
    expect(skillGrid?.className).toContain("2xl:grid-cols-6");
    expect(skillTitle?.className).not.toContain("bg-");

    const marketTab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent?.includes("skillMarketTab")
    );
    expect(marketTab).toBeDefined();
    await act(async () => marketTab?.click());

    const marketSkill = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Market Skill")
    );
    expect(marketSkill).toBeDefined();
    await act(async () => marketSkill?.click());
    expect(onOpenMarket).toHaveBeenCalledWith("market-1");
    expect(onPick).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <SkillMentionDialog
          open
          options={[{ id: "installed-1", kind: "skill", label: "Installed Skill" }]}
          marketOptions={[
            {
              id: "installed-1",
              catalogId: "market-2",
              installed: true,
              kind: "skill",
              label: "Installed Market Skill",
            },
          ]}
          onOpenChange={vi.fn()}
          onOpenMarket={onOpenMarket}
          onPick={onPick}
        />
      );
    });
    const renderedMarketTab = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    ).find((button) => button.textContent?.includes("skillMarketTab"));
    await act(async () => renderedMarketTab?.click());
    const installedMarketSkill = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent?.includes("Installed Market Skill"));
    await act(async () => installedMarketSkill?.click());
    expect(onOpenMarket).toHaveBeenLastCalledWith("market-2");
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("mentionCandidates", () => {
  const imageReferences = (count: number): MentionItem[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `image-${index + 1}`,
      kind: "image" as const,
      label: `Image${index + 1}`,
    }));

  it("lists every attached reference — bounded by the model policy, never a UI cap", () => {
    expect(mentionCandidates(imageReferences(13), "reference", "")).toHaveLength(13);
    expect(mentionCandidates(imageReferences(30), "reference", "")).toHaveLength(30);
  });

  it("keeps later references reachable by filtering on the typed query", () => {
    expect(mentionCandidates(imageReferences(30), "reference", "13").map((i) => i.label)).toEqual([
      "Image13",
    ]);
  });

  it("routes the skill trigger to skills only", () => {
    const mentions: MentionItem[] = [
      ...imageReferences(3),
      { id: "skill-1", kind: "skill", label: "CinematicLighting" },
    ];
    expect(mentionCandidates(mentions, "reference", "")).toHaveLength(3);
    expect(mentionCandidates(mentions, "skill", "")).toHaveLength(1);
  });
});

describe("mentionVisibleCount", () => {
  it("scrolls through every reference while skills keep their fixed quick-pick row", () => {
    expect(mentionVisibleCount("reference", 13)).toBe(13);
    expect(mentionVisibleCount("reference", 50)).toBe(50);
    expect(mentionVisibleCount("skill", 13)).toBe(8);
    expect(mentionVisibleCount("skill", 3)).toBe(3);
  });
});
