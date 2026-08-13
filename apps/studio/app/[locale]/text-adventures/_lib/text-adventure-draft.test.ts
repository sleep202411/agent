import { describe, expect, it } from "vitest";
import type { TextGameDetail } from "@repo/shared/text-game";
import {
  textAdventureDraftFormFromDetail,
  toTextAdventureUpdateInput,
} from "./text-adventure-draft";

const detail: TextGameDetail = {
  gameId: "tg_0123456789abcdef",
  projectId: null,
  status: "draft",
  rejectReason: null,
  draftVersionId: "1",
  publishedVersionId: null,
  publishedAt: null,
  offlineAt: null,
  createdAt: "2026-08-09T12:00:00Z",
  updatedAt: "2026-08-09T12:00:00Z",
  content: {
    versionId: "1",
    versionNo: 1,
    name: "World",
    posterUrl: "https://cdn.example.com/poster.jpg",
    synopsis: "Synopsis",
    worldviewDocxUrl: "https://cdn.example.com/world.docx",
    bgmUrl: "https://cdn.example.com/music.mp3",
    characters: [],
    stillUrls: ["https://cdn.example.com/still.jpg"],
  },
};

describe("text-adventure draft payload", () => {
  it("emits only changed fields", () => {
    const baseline = textAdventureDraftFormFromDetail(detail);
    expect(toTextAdventureUpdateInput({ ...baseline, name: "  New world  " }, baseline)).toEqual({
      name: "New world",
    });
  });

  it("uses an empty string to remove optional background music", () => {
    const baseline = textAdventureDraftFormFromDetail(detail);
    expect(toTextAdventureUpdateInput({ ...baseline, bgmUrl: "" }, baseline)).toEqual({
      bgmUrl: "",
    });
  });

  it("sends the complete ordered still list when it changes", () => {
    const baseline = textAdventureDraftFormFromDetail(detail);
    expect(toTextAdventureUpdateInput({ ...baseline, stillUrls: [] }, baseline)).toEqual({
      stillUrls: [],
    });
  });
});
