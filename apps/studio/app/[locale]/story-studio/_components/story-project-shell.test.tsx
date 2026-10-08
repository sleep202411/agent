import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { StoryProjectShell } from "./story-project-shell";
const state = vi.hoisted(() => ({ segment: "playtest" }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => state.segment }));
vi.mock("./story-project-agent-panel", () => ({
  StoryProjectAgentPanel: () => <span>story-project-agent-panel</span>,
}));
vi.mock("./story-project-header", () => ({
  StoryProjectHeader: () => <span>story-project-header</span>,
}));
vi.mock("./story-project-mobile-nav", () => ({
  StoryProjectMobileNav: () => <span>story-project-mobile-nav</span>,
}));
vi.mock("./story-project-rail", () => ({
  StoryProjectRail: () => <span>story-project-rail</span>,
}));
vi.mock("./story-project-share-dialog", () => ({
  StoryProjectShareDialog: () => <span>story-project-share-dialog</span>,
}));
vi.mock("./story-project-side-panel", () => ({
  StoryProjectSidePanel: () => <span>story-project-side-panel</span>,
}));
vi.mock("./story-project-work-view", () => ({
  StoryProjectWorkView: () => <span>story-project-work-view</span>,
}));
it("gives the preview its own full viewport without mounting the project panels", () => {
  state.segment = "playtest";
  const html = renderToStaticMarkup(
    <StoryProjectShell projectId="project-1">
      <main>Preview</main>
    </StoryProjectShell>
  );
  expect(html).toContain('data-slot="story-project-preview-shell"');
  expect(html).toContain("<main>Preview</main>");
  expect(html).not.toContain("story-project-agent-panel");
  expect(html).not.toContain("story-project-rail");
});
it("keeps the normal project shell on authoring routes", () => {
  state.segment = "canvas";
  const html = renderToStaticMarkup(
    <StoryProjectShell projectId="project-1">
      <main>Canvas</main>
    </StoryProjectShell>
  );
  expect(html).toContain("story-project-agent-panel");
  expect(html).toContain("story-project-rail");
});
