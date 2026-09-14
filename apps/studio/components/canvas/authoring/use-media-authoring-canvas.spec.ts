import { describe, expect, it } from "vitest";
import { ASSET_DRAG_MIME } from "./asset-library-dnd";
import {
  canvasAcceptedFileTypes,
  canvasUploadMediaKind,
  isExternalCanvasDrag,
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

  it("accepts mp3 and wav when audio is enabled", () => {
    const kinds = accepted(["image", "video", "audio"]);

    expect(canvasUploadMediaKind({ name: "line.mp3", type: "audio/mpeg" }, kinds)).toBe("audio");
    expect(canvasUploadMediaKind({ name: "line.mp3", type: "audio/mp3" }, kinds)).toBe("audio");
    expect(canvasUploadMediaKind({ name: "bed.wav", type: "audio/x-wav" }, kinds)).toBe("audio");
    expect(canvasUploadMediaKind({ name: "bed.wav", type: "" }, kinds)).toBe("audio");
  });

  it("rejects unsupported formats instead of deferring failure until upload confirmation", () => {
    const kinds = accepted(["image", "video"]);

    expect(canvasUploadMediaKind({ name: "animation.gif", type: "image/gif" }, kinds)).toBeNull();
    expect(canvasUploadMediaKind({ name: "clip.webm", type: "video/webm" }, kinds)).toBeNull();
    expect(canvasUploadMediaKind({ name: "voice.wav", type: "audio/wav" }, kinds)).toBeNull();
  });

  it("builds an exact file-picker accept contract", () => {
    expect(canvasAcceptedFileTypes(["image", "video"])).toBe(
      "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,video/mp4,video/quicktime,.mp4,.mov"
    );
    expect(canvasAcceptedFileTypes(["image", "video", "audio"])).toBe(
      "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,video/mp4,video/quicktime,.mp4,.mov,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,.mp3,.wav"
    );
  });

  it("treats OS files and library assets as canvas drops", () => {
    expect(isExternalCanvasDrag(["Files"])).toBe(true);
    expect(isExternalCanvasDrag([ASSET_DRAG_MIME])).toBe(true);
    expect(isExternalCanvasDrag(["text/plain"])).toBe(false);
  });
});
