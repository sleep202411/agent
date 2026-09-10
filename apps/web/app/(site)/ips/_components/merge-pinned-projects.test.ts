import { describe, expect, it } from "vitest";
import { mergePinnedProjects } from "./merge-pinned-projects";

const video = (id: string) => ({ id, trailer: `https://media.example.com/${id}.mp4` });
const coverOnly = (id: string) => ({ id, trailer: "" });

describe("video-first plaza pins", () => {
  it("keeps pins first within each group and removes duplicate ranked entries", () => {
    const ranked = [video("v1"), video("v2"), coverOnly("c1"), coverOnly("c2")];
    const pinned = [coverOnly("c2"), video("v2")];
    expect(mergePinnedProjects(ranked, pinned, false).map((item) => item.id)).toEqual([
      "v2",
      "v1",
      "c2",
      "c1",
    ]);
  });

  it("defers non-video pins while further video pages may exist", () => {
    const pins = [coverOnly("c"), video("v2")];
    expect(mergePinnedProjects([video("v1")], pins, true).map((item) => item.id)).toEqual([
      "v2",
      "v1",
    ]);
    expect(
      mergePinnedProjects([video("v1"), video("v2")], pins, false).map((item) => item.id)
    ).toEqual(["v2", "v1", "c"]);
  });

  it("shows non-video pins when pagination reaches that group", () => {
    const ranked = [video("v1"), coverOnly("c1")];
    expect(mergePinnedProjects(ranked, [coverOnly("c2")], true).map((item) => item.id)).toEqual([
      "v1",
      "c2",
      "c1",
    ]);
  });

  it("preserves relative order with no pins or no videos", () => {
    const ranked = [coverOnly("c1"), coverOnly("c2")];
    expect(mergePinnedProjects(ranked, [], false)).toEqual(ranked);
    expect(mergePinnedProjects(ranked, [coverOnly("c3")], true).map((item) => item.id)).toEqual([
      "c3",
      "c1",
      "c2",
    ]);
  });

  it("does not show non-video pins before the first ranked page has loaded", () => {
    expect(mergePinnedProjects([], [coverOnly("c")], true)).toEqual([]);
    expect(mergePinnedProjects([], [coverOnly("c")], false).map((item) => item.id)).toEqual(["c"]);
  });
});
