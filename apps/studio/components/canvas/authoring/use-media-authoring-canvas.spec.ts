import { describe, expect, it } from "vitest";
import {
  canvasAcceptedFileTypes,
  canvasUploadMediaKind,
  type UploadMediaKind,
} from "./use-media-authoring-canvas";

describe("canvas upload media policy", () => {
  const accepted = (kinds: UploadMediaKind[]) => new Set<UploadMediaKind>(kinds);

  it("accepts the image and video formats supported by the media service", () => {
    const kinds = accepted(["image", "video"]);

    expect(canvasUploadMediaKind({ name: "frame.webp", type: "image/webp" }, kinds)).toBe("image");
    expect(canvasUploadMediaKind({ name: "shot.mp4", type: "video/mp4" }, kinds)).toBe("video");
    expect(canvasUploadMediaKind({ name: "shot.mov", type: "" }, kinds)).toBe("video");
  });

  it("rejects unsupported formats instead of deferring failure until upload confirmation", () => {
    const kinds = accepted(["image", "video"]);

    expect(canvasUploadMediaKind({ name: "animation.gif", type: "image/gif" }, kinds)).toBeNull();
    expect(canvasUploadMediaKind({ name: "clip.webm", type: "video/webm" }, kinds)).toBeNull();
    expect(canvasUploadMediaKind({ name: "voice.wav", type: "audio/wav" }, kinds)).toBeNull();
  });

  it("builds an exact file-picker accept contract", () => {
    expect(canvasAcceptedFileTypes(["image", "video"])).toBe(
      "image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
    );
  });
});
