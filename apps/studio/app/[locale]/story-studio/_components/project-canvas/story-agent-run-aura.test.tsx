import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StoryAgentRunAura } from "./story-agent-run-aura";

describe("Story Agent run aura", () => {
  it("does not render while the Agent does not own the authoring transition", () => {
    expect(renderToStaticMarkup(<StoryAgentRunAura active={false} />)).toBe("");
  });

  it("renders a non-interactive, decorative glow on every viewport edge while active", () => {
    const html = renderToStaticMarkup(<StoryAgentRunAura active />);

    expect(html).toContain("data-story-agent-run-aura");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none fixed inset-0");
    expect(html.match(/data-story-agent-aura-edge=/g)).toHaveLength(4);
    expect(html.match(/data-story-agent-aura-ribbon=/g)).toHaveLength(4);
  });
});
