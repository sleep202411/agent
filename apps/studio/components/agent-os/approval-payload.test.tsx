// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApprovalPayload, type ApprovalPayloadLabels } from "./approval-payload";

/**
 * The approval card exists so a person can judge a write before it happens.
 * These pin the two things that decide whether it can: a destructive change is
 * counted and named, and a tool we have no shape for still shows something
 * rather than an empty card.
 */
const labels: ApprovalPayloadLabels = {
  creates: (count) => `Creates ${count}`,
  updates: (count) => `Updates ${count}`,
  deletes: (count) => `Deletes ${count}`,
  andMore: (count) => `+${count} more`,
  showDetails: "Show full request",
  hideDetails: "Hide full request",
  untitled: "Untitled",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderPayload(toolId: string, args: unknown) {
  act(() => {
    root.render(<ApprovalPayload toolId={toolId} args={args} labels={labels} />);
  });
  return container.textContent ?? "";
}

describe("ApprovalPayload", () => {
  it("counts and names the shots a write would delete", () => {
    const text = renderPayload("storyboard.deleteShots", {
      shotIds: ["shot-a", "shot-b", "shot-c"],
    });
    expect(text).toContain("Deletes 3");
    expect(text).toContain("shot-a");
  });

  it("separates new shots from edits to existing ones", () => {
    const text = renderPayload("storyboard.upsertShots", {
      shots: [
        { id: "s1", intent: "create", title: "开场", prompt: "wide rooftop" },
        { id: "s2", intent: "replace", title: "改写的镜头" },
      ],
    });
    expect(text).toContain("Creates 1");
    expect(text).toContain("Updates 1");
    expect(text).toContain("开场");
    expect(text).toContain("改写的镜头");
  });

  it("reads a character's localized name rather than printing an object", () => {
    const text = renderPayload("characters.upsert", {
      characters: [{ id: "lin-daiyu", name: { "zh-CN": "林黛玉" }, summary: "敏感聪慧" }],
    });
    expect(text).toContain("林黛玉");
    expect(text).not.toContain("[object Object]");
  });

  it("collapses a long batch instead of flooding the card", () => {
    const text = renderPayload("storyboard.upsertShots", {
      shots: Array.from({ length: 20 }, (_, index) => ({
        id: `s${index}`,
        intent: "create",
        title: `镜头 ${index}`,
      })),
    });
    expect(text).toContain("Creates 20");
    expect(text).toContain("+14 more");
  });

  it("still shows the raw payload for a tool it has no shape for", () => {
    const text = renderPayload("some.future.tool", { mystery: "value" });
    expect(text).toContain("mystery");
  });

  it("renders nothing when there is no payload at all", () => {
    renderPayload("storyboard.upsertShots", null);
    expect(container.firstChild).toBeNull();
  });
});
