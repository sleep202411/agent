import { describe, expect, it } from "vitest";
import {
  assignmentRowAnchorId,
  episodeRowAnchorId,
  workspaceDeeplinkAnchors,
} from "./deeplink-anchors";

/**
 * The anchor ids are a contract between three files (the board writes
 * the episode row, the assignment table writes the assignment row, the
 * page reads both), and the ORDER is the whole reason `?assignment=`
 * exists: dropping to the episode anchor when the notification named a
 * row leaves the reader scrolled to a header instead of to the work.
 */

/** What the server emits for "member submitted EP03". */
const SUBMITTED = new URLSearchParams("tab=episodes&episode=ep_42&assignment=as_7");

describe("workspaceDeeplinkAnchors", () => {
  it("puts the assignment row ahead of the episode row", () => {
    expect(workspaceDeeplinkAnchors("episodes", SUBMITTED)).toEqual([
      "assignment-row-as_7",
      "episode-row-ep_42",
    ]);
  });

  it("falls back to the episode alone when the notification named no row", () => {
    expect(
      workspaceDeeplinkAnchors("episodes", new URLSearchParams("tab=episodes&episode=ep_42"))
    ).toEqual(["episode-row-ep_42"]);
  });

  it.each(["overview", "roles", "members"] as const)(
    "targets nothing on the %s tab, which renders no such row",
    (tab) => {
      expect(workspaceDeeplinkAnchors(tab, SUBMITTED)).toEqual([]);
    }
  );

  it("targets nothing when the link carries no ids", () => {
    expect(workspaceDeeplinkAnchors("episodes", new URLSearchParams("tab=episodes"))).toEqual([]);
  });
});

describe("the anchor id spellings", () => {
  it("are the ones the board and the assignment table render", () => {
    expect(episodeRowAnchorId("ep_42")).toBe("episode-row-ep_42");
    expect(assignmentRowAnchorId("as_7")).toBe("assignment-row-as_7");
  });
});
