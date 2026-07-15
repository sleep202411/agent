import { describe, expect, it } from "vitest";
import {
  allowsCanvasManualPlayback,
  allowsCanvasMediaPreview,
} from "./canvas-media-preview-policy";

describe("canvas media hover preview policy", () => {
  it("allows a stable select-mode canvas at an inspectable scale", () => {
    expect(
      allowsCanvasMediaPreview({
        tool: "select",
        scale: 0.78,
        panReady: false,
        panning: false,
        nodeDragging: false,
      })
    ).toBe(true);
  });

  it("keeps overview and Hand mode free of accidental playback", () => {
    const idle = {
      panReady: false,
      panning: false,
      nodeDragging: false,
    };
    expect(allowsCanvasMediaPreview({ ...idle, tool: "select", scale: 0.49 })).toBe(false);
    expect(allowsCanvasMediaPreview({ ...idle, tool: "pan", scale: 1 })).toBe(false);
  });

  it("rejects every active pointer manipulation", () => {
    const base = { tool: "select" as const, scale: 1 };
    expect(
      allowsCanvasMediaPreview({
        ...base,
        panReady: true,
        panning: false,
        nodeDragging: false,
      })
    ).toBe(false);
    expect(
      allowsCanvasMediaPreview({
        ...base,
        panReady: false,
        panning: true,
        nodeDragging: false,
      })
    ).toBe(false);
    expect(
      allowsCanvasMediaPreview({
        ...base,
        panReady: false,
        panning: false,
        nodeDragging: true,
      })
    ).toBe(false);
  });

  it("keeps manual playback available across tools and zoom, but not during a gesture", () => {
    expect(
      allowsCanvasManualPlayback({ panReady: false, panning: false, nodeDragging: false })
    ).toBe(true);
    expect(
      allowsCanvasManualPlayback({ panReady: true, panning: false, nodeDragging: false })
    ).toBe(false);
    expect(
      allowsCanvasManualPlayback({ panReady: false, panning: true, nodeDragging: false })
    ).toBe(false);
    expect(
      allowsCanvasManualPlayback({ panReady: false, panning: false, nodeDragging: true })
    ).toBe(false);
  });
});
