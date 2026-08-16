import { describe, expect, it } from "vitest";
import {
  projectAssetToCanvasAsset,
  projectAssetToMentionItem,
  type ProjectAsset,
} from "./use-project-assets";

const audioAsset: ProjectAsset = {
  id: "crew:file-1",
  mediaAssetId: "media-1",
  kind: "audio",
  url: "https://media.example/audio.mp3",
  name: "Rain ambience",
  durationSeconds: 8.25,
  bytes: 1024,
  createdAt: 1,
  origin: "crew",
  category: "general",
};

describe("project asset adapters", () => {
  it("preserves durable media metadata for generation references", () => {
    expect(projectAssetToMentionItem(audioAsset, [audioAsset])).toMatchObject({
      id: "crew:file-1",
      assetId: "media-1",
      kind: "audio",
      previewUrl: "https://media.example/audio.mp3",
      durationSeconds: 8.25,
      bytes: 1024,
    });
  });

  it("preserves duration and byte size when adapting to the canvas inventory", () => {
    expect(projectAssetToCanvasAsset(audioAsset)).toMatchObject({
      id: "crew:file-1",
      mediaAssetId: "media-1",
      kind: "audio",
      source: "uploaded",
      durationSeconds: 8.25,
      bytes: 1024,
    });
  });
});
