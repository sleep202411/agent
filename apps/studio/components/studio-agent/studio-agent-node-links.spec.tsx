import { describe, expect, it, vi } from "vitest";

import {
  resolveStudioAgentNodeReference,
  type StudioAgentNodeLinks,
} from "./studio-agent-node-links";

/**
 * WHICH CODE SPANS ARE PLACES.
 *
 * An assistant reply that creates a node reads like this:
 *
 *   "我注意到当前章节已有一个空的影片节点（`clip:new_scene`）…
 *    节点ID: `scene_harbour_dawn_prose` … 通过修改 `exit` 属性…
 *    已设置为中文（`zh-CN`）"
 *
 * Three of those five spans are not places. Linking them all would hand the
 * creator dead affordances, and a dead link teaches them to stop trusting the
 * live ones — worse than no links at all. So a span is resolved against the
 * graph that actually exists, never against a shape.
 */
describe("resolveStudioAgentNodeReference", () => {
  const links = (nodeIds: string[]): StudioAgentNodeLinks => ({
    has: (nodeId) => nodeIds.includes(nodeId),
    focus: vi.fn(),
  });

  it("resolves a bare id the canvas actually has", () => {
    expect(
      resolveStudioAgentNodeReference(
        "scene_harbour_dawn_prose",
        links(["scene_harbour_dawn_prose"])
      )
    ).toBe("scene_harbour_dawn_prose");
  });

  it("resolves the kind-prefixed form the agent writes for the reader", () => {
    expect(resolveStudioAgentNodeReference("clip:new_scene", links(["new_scene"]))).toBe(
      "new_scene"
    );
  });

  it("refuses a property name, which is the span most likely to be mistaken for one", () => {
    expect(resolveStudioAgentNodeReference("exit", links(["scene_one"]))).toBeNull();
  });

  it("refuses a prefixed name whose suffix the canvas does not have", () => {
    // The prefix is stripped and RE-CHECKED, never trusted. Without that,
    // anything with a colon becomes a link to whatever follows it — and the
    // agent writes `text:`, `kind:` and time codes in the same breath.
    expect(
      resolveStudioAgentNodeReference("text:scene_that_was_deleted", links(["scene_one"]))
    ).toBeNull();
  });

  it("refuses a name the canvas does not have, however node-shaped it looks", () => {
    expect(
      resolveStudioAgentNodeReference("scene_that_was_deleted", links(["scene_one"]))
    ).toBeNull();
  });

  it("refuses prose that happens to be in a code span", () => {
    expect(resolveStudioAgentNodeReference("the second node", links(["the"]))).toBeNull();
  });

  it("refuses an empty or absurd span rather than asking the canvas about it", () => {
    const probe = links([]);
    const has = vi.spyOn(probe, "has");
    expect(resolveStudioAgentNodeReference("   ", probe)).toBeNull();
    expect(resolveStudioAgentNodeReference("x".repeat(200), probe)).toBeNull();
    expect(has).not.toHaveBeenCalled();
  });
});
