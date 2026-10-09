import { describe, expect, it } from "vitest";
import {
  ExperienceJourneyAnchorSchema,
  ExperienceJourneyAccessRefsSchema,
  ExperienceJourneyDeltaSchema,
  ExperienceJourneyPathSchema,
  ExperienceJourneySchema,
} from "./journey.js";

const metadata = {
  version: 1,
  signature: "journey-v1:test",
  visitedNodeIds: ["one"],
  traversedEdges: [],
  traversedPaths: [],
  watchedMedia: [],
  activeAccessRefs: [],
};
const anchor = {
  sceneId: "one",
  state: {
    currentSceneId: "one",
    status: "active",
    values: { session: {}, player: {}, scene: {} },
    deterministicRuntime: { audioCuePlayCounts: {} },
  },
  events: [],
  requiredAccessRefs: [],
};
const delta = {
  version: 1,
  signature: metadata.signature,
  addedVisitedNodeIds: [],
  addedTraversedEdges: [],
  addedTraversedPaths: [],
  addedWatchedMedia: [],
  anchors: [],
};

describe("journey data bounds", () => {
  it("round trips entry snapshots and incremental changes", () => {
    expect(ExperienceJourneySchema.parse({ ...metadata, anchors: [anchor] })).toEqual({
      ...metadata,
      anchors: [anchor],
    });
    expect(ExperienceJourneyDeltaSchema.parse({ ...delta, anchors: [anchor] }).anchors).toEqual([
      anchor,
    ]);
  });
  it("rejects nested journeys, unknown checkpoint fields and mixed scene/ending destinations", () => {
    expect(ExperienceJourneyAnchorSchema.safeParse({ ...anchor, journey: metadata }).success).toBe(
      false
    );
    expect(
      ExperienceJourneyAnchorSchema.safeParse({
        ...anchor,
        state: { ...anchor.state, journey: metadata },
      }).success
    ).toBe(false);
    expect(
      ExperienceJourneyAnchorSchema.safeParse({ ...anchor, playback: { journey: metadata } })
        .success
    ).toBe(false);
    expect(
      ExperienceJourneySchema.safeParse({
        ...metadata,
        anchors: [],
        traversedEdges: [
          {
            fromSceneId: "one",
            bindingId: "binding",
            routeId: "route",
            toSceneId: "two",
            toEndingId: "end",
          },
        ],
      }).success
    ).toBe(false);
  });
  it("rejects cycles, invalid numbers and excessive nesting before serialization", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() =>
      ExperienceJourneyAnchorSchema.safeParse({ ...anchor, state: cycle })
    ).not.toThrow();
    expect(ExperienceJourneyAnchorSchema.safeParse({ ...anchor, state: cycle }).success).toBe(
      false
    );
    expect(
      ExperienceJourneyAnchorSchema.safeParse({ ...anchor, state: { time: Infinity } }).success
    ).toBe(false);
    expect(
      ExperienceJourneyAnchorSchema.safeParse({ ...anchor, state: { map: new Map() } }).success
    ).toBe(false);
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 30; index++) deep = { child: deep };
    expect(ExperienceJourneyAnchorSchema.safeParse({ ...anchor, state: deep }).success).toBe(false);
  });
  it("limits entry bytes, delta bytes, and changed anchor counts", () => {
    expect(
      ExperienceJourneyAnchorSchema.safeParse({
        ...anchor,
        state: { text: "a".repeat(128 * 1024) },
      }).success
    ).toBe(false);
    expect(
      ExperienceJourneyDeltaSchema.safeParse({
        ...delta,
        anchors: Array.from({ length: 65 }, (_, index) => ({
          ...anchor,
          sceneId: `scene-${index}`,
        })),
      }).success
    ).toBe(false);
    const large = { ...anchor, state: { text: "a".repeat(100 * 1024) } };
    expect(ExperienceJourneyAnchorSchema.safeParse(large).success).toBe(true);
    expect(
      ExperienceJourneyDeltaSchema.safeParse({
        ...delta,
        anchors: Array.from({ length: 6 }, (_, index) => ({ ...large, sceneId: `scene-${index}` })),
      }).success
    ).toBe(false);
  });
  it("permits independently valid dense anchors inside bounded full and delta collections", () => {
    const dense = { ...anchor, state: { values: Array.from({ length: 18_000 }, () => 0) } };
    expect(ExperienceJourneyAnchorSchema.safeParse(dense).success).toBe(true);
    const anchors = Array.from({ length: 12 }, (_, index) => ({
      ...dense,
      sceneId: `scene-${index}`,
    }));
    expect(ExperienceJourneyDeltaSchema.safeParse({ ...delta, anchors }).success).toBe(true);
    expect(
      ExperienceJourneySchema.safeParse({
        ...metadata,
        anchors: Array.from({ length: 100 }, (_, index) => ({
          ...dense,
          sceneId: `scene-${index}`,
        })),
      }).success
    ).toBe(true);
  });
  it("bounds atomic access chains and paths so each remains transportable", () => {
    const longId = "a".repeat(160);
    const ref = { kind: "route", sceneId: longId, bindingId: longId, routeId: longId };
    const edge = { fromSceneId: longId, bindingId: longId, routeId: longId, toSceneId: longId };
    expect(ExperienceJourneyAccessRefsSchema.safeParse([ref]).success).toBe(true);
    expect(ExperienceJourneyPathSchema.safeParse([edge]).success).toBe(true);
    // Both collections remain below their item-count limits; bytes are the boundary.
    expect(ExperienceJourneyAccessRefsSchema.safeParse(Array(300).fill(ref)).success).toBe(false);
    expect(ExperienceJourneyPathSchema.safeParse(Array(500).fill(edge)).success).toBe(false);
  });
});
