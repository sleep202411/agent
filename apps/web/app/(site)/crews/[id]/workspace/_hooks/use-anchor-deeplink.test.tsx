// @vitest-environment jsdom

/**
 * The crew notification deeplink
 * (`/crews/{id}/workspace?tab=episodes&episode={id}&assignment={id}`)
 * targets rows the episodes board only renders once its queries
 * resolve — and the assignment row only once its episode is expanded,
 * strictly after the episode row exists. The hook must therefore
 * survive mounting against an empty document (the case a naive
 * `getElementById` on mount silently fails) and must not settle for the
 * coarse anchor when the precise one is still on its way.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAnchorDeeplink } from "./use-anchor-deeplink";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ScrollCall {
  id: string;
  options: unknown;
}

/** jsdom has no layout, so it ships no `scrollIntoView` at all. */
let scrolls: ScrollCall[] = [];
Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
  scrolls.push({ id: this.id, options });
};

function Probe({ anchorIds }: { anchorIds: readonly string[] }) {
  useAnchorDeeplink(anchorIds);
  return null;
}

let container: HTMLDivElement;
let root: Root;

/** Stand-in for the row the episodes board renders. */
function renderAnchor(id: string): HTMLDivElement {
  const row = document.createElement("div");
  row.id = id;
  document.body.appendChild(row);
  return row;
}

const SMOOTH = { behavior: "smooth", block: "start" };

beforeEach(() => {
  scrolls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("useAnchorDeeplink", () => {
  it("scrolls to an anchor that is already in the document", () => {
    renderAnchor("episode-row-ep_42");

    act(() => root.render(<Probe anchorIds={["episode-row-ep_42"]} />));

    expect(scrolls).toEqual([{ id: "episode-row-ep_42", options: SMOOTH }]);
  });

  it("waits for an anchor that appears after the episodes query resolves", async () => {
    await act(async () => root.render(<Probe anchorIds={["episode-row-ep_7"]} />));
    expect(scrolls).toEqual([]);

    await act(async () => {
      renderAnchor("episode-row-ep_7");
    });

    expect(scrolls).toEqual([{ id: "episode-row-ep_7", options: SMOOTH }]);
  });

  it("does nothing without a deeplink, even when rows are on screen", async () => {
    renderAnchor("episode-row-ep_1");

    await act(async () => root.render(<Probe anchorIds={[]} />));
    await act(async () => {
      renderAnchor("episode-row-ep_2");
    });

    expect(scrolls).toEqual([]);
  });

  it("scrolls once per anchor, so refetches do not yank the page back", async () => {
    await act(async () => root.render(<Probe anchorIds={["episode-row-ep_7"]} />));
    await act(async () => {
      renderAnchor("episode-row-ep_7");
    });
    expect(scrolls).toHaveLength(1);

    // A refetch re-renders the board: same row, new node.
    await act(async () => {
      document.getElementById("episode-row-ep_7")?.remove();
      renderAnchor("episode-row-ep_7");
    });
    await act(async () => root.render(<Probe anchorIds={["episode-row-ep_7"]} />));

    expect(scrolls).toHaveLength(1);
  });

  it("follows a second notification opened while the workspace is mounted", async () => {
    renderAnchor("episode-row-ep_7");
    await act(async () => root.render(<Probe anchorIds={["episode-row-ep_7"]} />));

    renderAnchor("episode-row-ep_9");
    await act(async () => root.render(<Probe anchorIds={["episode-row-ep_9"]} />));

    expect(scrolls.map((s) => s.id)).toEqual(["episode-row-ep_7", "episode-row-ep_9"]);
  });

  it("stops watching once the workspace unmounts", async () => {
    await act(async () => root.render(<Probe anchorIds={["episode-row-ep_7"]} />));

    act(() => root.unmount());
    await act(async () => {
      renderAnchor("episode-row-ep_7");
    });

    expect(scrolls).toEqual([]);
    // afterEach unmounts again; React tolerates a repeat unmount.
  });
});

describe("an assignment deeplink, whose row lands after its episode's", () => {
  const ANCHORS = ["assignment-row-as_1", "episode-row-ep_3"] as const;

  it("lands on the episode first, then refines onto the assignment row", async () => {
    await act(async () => root.render(<Probe anchorIds={ANCHORS} />));

    await act(async () => {
      renderAnchor("episode-row-ep_3");
    });
    expect(scrolls.map((s) => s.id)).toEqual(["episode-row-ep_3"]);

    // The accordion body mounts and its assignments query resolves.
    await act(async () => {
      renderAnchor("assignment-row-as_1");
    });
    expect(scrolls.map((s) => s.id)).toEqual(["episode-row-ep_3", "assignment-row-as_1"]);
  });

  it("goes straight to the assignment row when both are already there", async () => {
    renderAnchor("episode-row-ep_3");
    renderAnchor("assignment-row-as_1");

    await act(async () => root.render(<Probe anchorIds={ANCHORS} />));

    expect(scrolls.map((s) => s.id)).toEqual(["assignment-row-as_1"]);
  });

  it("never falls back down to the episode once it has the assignment row", async () => {
    renderAnchor("episode-row-ep_3");
    renderAnchor("assignment-row-as_1");
    await act(async () => root.render(<Probe anchorIds={ANCHORS} />));

    // A refetch replaces both nodes.
    await act(async () => {
      document.getElementById("assignment-row-as_1")?.remove();
      renderAnchor("episode-row-ep_3");
      renderAnchor("assignment-row-as_1");
    });

    expect(scrolls.map((s) => s.id)).toEqual(["assignment-row-as_1"]);
  });

  it("still lands on the episode when the assignment row never renders", async () => {
    await act(async () => root.render(<Probe anchorIds={ANCHORS} />));
    await act(async () => {
      renderAnchor("episode-row-ep_3");
    });

    // Unassigned since the notification was sent — the row is gone for
    // good, and the reader must not be left at the top of the page.
    expect(scrolls.map((s) => s.id)).toEqual(["episode-row-ep_3"]);
  });
});
