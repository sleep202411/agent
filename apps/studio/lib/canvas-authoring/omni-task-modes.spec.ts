import { describe, expect, it } from "vitest";
import {
  applyOmniModeSelection,
  lockedSettingFields,
  menuValueForMode,
  modeMenuValues,
} from "./omni-task-modes";

describe("omni task mode menu", () => {
  it("inserts edit/extend after omni reference when the schema offers them", () => {
    expect(
      modeMenuValues(
        ["text_to_video", "multimodal_to_video", "image_to_video"],
        ["auto", "reference", "edit", "extend"]
      )
    ).toEqual([
      "text_to_video",
      "multimodal_to_video",
      "multimodal_to_video::edit",
      "multimodal_to_video::extend",
      "image_to_video",
    ]);
  });

  it("maps a composite menu value to mode + locked settings", () => {
    expect(
      applyOmniModeSelection("multimodal_to_video::edit", {
        aspectRatio: "16:9",
        duration: "5",
        resolution: "720p",
      })
    ).toEqual({
      mode: "multimodal_to_video",
      settings: {
        aspectRatio: "auto",
        duration: "auto",
        resolution: "720p",
        omniReferenceTaskType: "edit",
      },
    });
    expect(lockedSettingFields("edit")).toEqual(new Set(["aspectRatio", "duration"]));
  });

  it("resets the task type when leaving an omni sub-intent", () => {
    expect(
      applyOmniModeSelection("text_to_video", { omniReferenceTaskType: "edit", duration: "auto" })
    ).toEqual({
      mode: "text_to_video",
      settings: { omniReferenceTaskType: "auto", duration: "auto" },
    });
    expect(menuValueForMode("multimodal_to_video", "extend")).toBe("multimodal_to_video::extend");
  });
});
