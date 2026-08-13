// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSkillCatalogItem } from "@/lib/project-skills-api";
import { ProjectSkillDetailDialog } from "./project-skill-detail-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/image", () => ({
  default: ({ fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    void fill;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt ?? ""} {...props} />;
  },
}));

const marketSkill: ProjectSkillCatalogItem = {
  id: "catalog-skill-1",
  slug: "cinematic-lighting",
  name: "Cinematic Lighting",
  description: "A reusable lighting direction.",
  localizedMetadata: null,
  publisherName: "FizzDragon",
  category: "style",
  kind: "general",
  visibility: "public",
  ownershipScope: "community",
  previewUrl: "/skill.jpg",
  previewVideoUrl: null,
  latestVersion: {
    id: "version-1",
    version: "1.0.0",
    checksum: "checksum",
    capabilities: ["image_generation", "video_generation"],
    projectKinds: ["platform", "story"],
    workbenchModes: [],
  },
  installation: null,
};

describe("ProjectSkillDetailDialog", () => {
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

  it("offers install-and-use for a market Skill and delegates the action", async () => {
    const onUse = vi.fn();
    await act(async () => {
      root.render(
        <ProjectSkillDetailDialog
          open
          skill={marketSkill}
          canInstall
          onUse={onUse}
          onOpenChange={vi.fn()}
        />
      );
    });

    expect(document.body.textContent).toContain("detail.installToUse");
    expect(document.body.textContent).not.toContain("detail.activeForGeneration");
    const action = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("detail.installAndUse")
    );
    expect(action).toBeDefined();
    await act(async () => action?.click());
    expect(onUse).toHaveBeenCalledWith(marketSkill);
  });

  it("disables installation when the current member cannot manage project Skills", async () => {
    await act(async () => {
      root.render(
        <ProjectSkillDetailDialog
          open
          skill={marketSkill}
          canInstall={false}
          onUse={vi.fn()}
          onOpenChange={vi.fn()}
        />
      );
    });

    const action = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("detail.installAndUse")
    );
    expect(action?.disabled).toBe(true);
  });
});
