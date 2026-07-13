import { describe, expect, it } from "vitest";
import { shouldPrepareStoryClip, StoryClipPreparationGate } from "./story-clip-preparation-gate";

describe("shouldPrepareStoryClip", () => {
  const eligible = {
    graphNodeId: "clip:S01",
    hasMaterializedClip: false,
    masterDirection: "Slow push toward the villa.",
    canGenerate: true,
    draftSettled: true,
    draftRevision: 7,
  };

  it("requires an authored, saved, unmaterialized clip and generation permission", () => {
    expect(shouldPrepareStoryClip(eligible)).toBe(true);
    expect(shouldPrepareStoryClip({ ...eligible, graphNodeId: null })).toBe(false);
    expect(shouldPrepareStoryClip({ ...eligible, hasMaterializedClip: true })).toBe(false);
    expect(shouldPrepareStoryClip({ ...eligible, masterDirection: "  " })).toBe(false);
    expect(shouldPrepareStoryClip({ ...eligible, canGenerate: false })).toBe(false);
    expect(shouldPrepareStoryClip({ ...eligible, draftSettled: false })).toBe(false);
    expect(shouldPrepareStoryClip({ ...eligible, draftRevision: 0 })).toBe(false);
  });
});

describe("StoryClipPreparationGate", () => {
  it("suppresses effect replays and repeated attempts for the same immutable draft", () => {
    const gate = new StoryClipPreparationGate();

    expect(gate.tryStart("clip:S01", "draft:7")).toBe(true);
    expect(gate.tryStart("clip:S01", "draft:7")).toBe(false);
    expect(gate.settle("clip:S01", "draft:7", "failed")).toBe(true);
    expect(gate.tryStart("clip:S01", "draft:7")).toBe(false);

    expect(gate.tryStart("clip:S01", "draft:8")).toBe(true);
    expect(gate.settle("clip:S01", "draft:8", "succeeded")).toBe(true);
    expect(gate.tryStart("clip:S01", "draft:8")).toBe(false);
  });

  it("allows different graph nodes while keeping their request state isolated", () => {
    const gate = new StoryClipPreparationGate();

    expect(gate.tryStart("clip:S01", "draft:7")).toBe(true);
    expect(gate.tryStart("clip:S02", "draft:7")).toBe(true);
    expect(gate.settle("clip:S02", "draft:7", "succeeded")).toBe(true);
    expect(gate.get("clip:S01")).toEqual({ key: "draft:7", status: "pending" });
    expect(gate.get("clip:S02")).toEqual({ key: "draft:7", status: "succeeded" });
  });

  it("rekeys a queued trigger to the revision actually captured by the snapshot coordinator", () => {
    const gate = new StoryClipPreparationGate();

    expect(gate.tryStart("clip:S01", "draft:7")).toBe(true);
    expect(gate.rekey("clip:S01", "draft:7", "draft:8")).toBe(true);
    expect(gate.settle("clip:S01", "draft:7", "failed")).toBe(false);
    expect(gate.settle("clip:S01", "draft:8", "failed")).toBe(true);
    expect(gate.tryStart("clip:S01", "draft:8")).toBe(false);
  });
});
