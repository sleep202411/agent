import { expect, it } from "vitest";
import { timelineCandidateId } from "./story-timeline-candidate";
import type { TimelineSequence } from "./story-timeline-api";
const mediaId = "00000000-0000-4000-8000-000000000007";
const source = (patch: object = {}, kind = "video") =>
  ({
    clips: [
      {
        id: "clip",
        kind,
        selectedMediaVersion: {
          mediaAssetId: mediaId,
          mediaKind: "video",
          mediaStatus: "ready",
          ...patch,
        },
      },
    ],
  }) as unknown as TimelineSequence;
it("returns a saved video's media identity", () => {
  expect(timelineCandidateId(source(), "clip")).toBe(mediaId);
});
it("supports saved images", () => {
  expect(timelineCandidateId(source({ mediaKind: "image" }, "image"), "clip")).toBe(mediaId);
});
it.each([
  { mediaAssetId: "version-not-media" },
  { mediaStatus: "uploading" },
  { mediaStatus: "deleted" },
  { mediaKind: "audio" },
  { mediaKind: "image" },
])("rejects unavailable or mismatched media %j", (patch) => {
  expect(timelineCandidateId(source(patch), "clip")).toBeUndefined();
});
it("does not invent media for new, missing or unselected clips", () => {
  expect(timelineCandidateId(source())).toBeUndefined();
  expect(timelineCandidateId(source(), "new")).toBeUndefined();
  expect(timelineCandidateId(undefined, "clip")).toBeUndefined();
});
