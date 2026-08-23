// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentOsApprovalComposer } from "./agent-os-approval-composer";

const payloadLabels = {
  creates: (count: number) => `Creates ${count}`,
  updates: (count: number) => `Updates ${count}`,
  deletes: (count: number) => `Deletes ${count}`,
  andMore: (count: number) => `${count} more`,
  showDetails: "Show details",
  hideDetails: "Hide details",
  untitled: "Untitled",
  storyBible: "Story bible",
  storyEntry: "Story entry",
  sceneOrder: "Scene order",
  storyScene: "Story scene",
};

describe("AgentOsApprovalComposer focus contract", () => {
  let host: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const flushFrames = async () => {
    const pending = frames.splice(0);
    await act(async () => pending.forEach((callback) => callback(0)));
  };

  it("announces and focuses the blocking gate, then restores the composer", async () => {
    await act(async () => {
      root.render(<textarea data-agent-composer-input="true" aria-label="Message" />);
    });
    host.querySelector<HTMLTextAreaElement>("textarea")?.focus();

    await act(async () => {
      root.render(
        <AgentOsApprovalComposer
          approval={{ toolId: "characters.upsert", arguments: { characters: [] } }}
          busy={false}
          labels={{
            title: "Approval required",
            approve: "Approve",
            reject: "Reject",
            payload: payloadLabels,
          }}
          onApprove={vi.fn()}
        />
      );
    });
    await flushFrames();

    const region = host.querySelector<HTMLElement>("[data-agent-composer-gate]");
    const title = region?.querySelector<HTMLElement>("p[tabindex='-1']");
    expect(region?.getAttribute("aria-labelledby")).toBe(title?.id);
    expect(region?.querySelector("[role='status'][aria-live='polite']")?.textContent).toBe(
      "Approval required"
    );
    expect(document.activeElement).toBe(title);

    await act(async () => {
      root.render(<textarea data-agent-composer-input="true" aria-label="Message" />);
    });
    await flushFrames();
    expect(document.activeElement).toBe(host.querySelector("textarea"));
  });
});
