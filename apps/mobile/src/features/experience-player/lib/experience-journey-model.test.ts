import { describe, expect, it } from "vitest";
import { initializeExperienceRuntime } from "@repo/experience-engine";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import {
  createExperienceJourney,
  createExperienceJourneyAnchor,
  recordExperienceJourney,
  restoreExperienceJourneyAnchor,
  validateExperienceJourney,
} from "./experience-journey-model";
import {
  mediaPlaybackSignature,
  scenePlaybackSignature,
  type ExperiencePlaybackCheckpoint,
} from "./experience-playback-checkpoint";

function fixture() {
  const scene = {
    kind: "scene",
    sceneId: "one",
    clock: { kind: "renderer", rendererInstanceId: "video" },
    renderers: [
      {
        rendererId: "core.video",
        instanceId: "video",
        layer: 0,
        config: {
          fit: "cover",
          autoplay: true,
          sequence: [{ clipId: "clip", assetId: "asset", endBehavior: { behavior: "advance" } }],
        },
        bindings: {},
      },
    ],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: [],
    access: { key: "node:one", communityPointPrice: 20, title: { "en-US": "One" } },
  };
  const manifest = {
    graph: { entrySceneId: "one", nodes: [scene] },
    stateDefinitions: [{ key: "count", scope: "session", valueType: "number", initialValue: 1 }],
    assets: [
      {
        assetId: "asset",
        kind: "video",
        variants: [{ uri: "/asset.mp4", sha256: "a".repeat(64) }],
      },
    ],
    endings: [],
  } as unknown as ExperienceRuntimeManifest;
  const state = initializeExperienceRuntime(manifest, { randomSeed: "same-seed" });
  const playback: ExperiencePlaybackCheckpoint = {
    version: 1,
    sceneId: "one",
    sceneSignature: scenePlaybackSignature(manifest.graph.nodes[0] as never),
    sceneTimeMs: 0,
    fixedClockEnded: false,
    cursor: { sceneId: "one", positionMs: -1, firedOnceCueIds: [] },
    openRendererIds: ["video"],
    settledGestureIds: [],
    parkedEvents: [],
    media: [],
    playbackEnabled: true,
    rate: 2,
  };
  return { manifest, state, playback };
}

describe("typed story entry anchors", () => {
  it("takes only entry checkpoint fields and never recursively stores journey", () => {
    const { manifest, state, playback } = fixture();
    const journey = createExperienceJourney(manifest);
    const anchor = createExperienceJourneyAnchor(manifest, {
      state,
      events: [],
      playback,
      journey,
    } as Parameters<typeof createExperienceJourneyAnchor>[1]);
    expect(Object.keys(anchor).sort()).toEqual([
      "events",
      "playback",
      "requiredAccessRefs",
      "sceneId",
      "state",
    ]);
    expect(JSON.stringify(anchor)).not.toContain('"journey"');
    const exploration = recordExperienceJourney(manifest, journey, { anchor });
    expect(validateExperienceJourney(manifest, exploration)).toEqual(exploration);
  });
  it("rechecks current access and preserves precise entry state and deterministic seed", () => {
    const { manifest, state, playback } = fixture();
    const anchor = createExperienceJourneyAnchor(manifest, { state, events: [], playback });
    const journey = recordExperienceJourney(manifest, createExperienceJourney(manifest), {
      anchor,
    });
    expect(() =>
      restoreExperienceJourneyAnchor(manifest, journey, "one", { canAccess: () => false })
    ).toThrow(/unlock required/);
    const restored = restoreExperienceJourneyAnchor(manifest, journey, "one", {
      canAccess: () => true,
      watchedAssetIds: ["asset"],
    });
    expect(restored.state.values.session.count).toBe(1);
    expect(restored.state.deterministicRuntime.randomSeed).toBe("same-seed");
    expect(restored.state.watchedAssetIds).toEqual(["asset"]);
    expect(restored.playback).toEqual(playback);
    restored.state.values.session.count = 8;
    expect(anchor.state.values).toEqual(state.values);
  });
  it("keeps partial viewing credit monotone without copying entry snapshots on progress", () => {
    const { manifest, state, playback } = fixture();
    const anchor = createExperienceJourneyAnchor(manifest, { state, events: [], playback });
    const base = recordExperienceJourney(manifest, createExperienceJourney(manifest), { anchor });
    const media = {
      sceneId: "one",
      rendererInstanceId: "video",
      sequenceIndex: 0,
      assetId: "asset",
      mediaSignature: mediaPlaybackSignature(manifest, "asset"),
      watchedUntilMs: 3000,
    };
    const next = recordExperienceJourney(manifest, base, { watchedMedia: [media] });
    expect(next.anchors).toBe(base.anchors);
    expect(next.anchors[0]).toBe(base.anchors[0]);
    expect(
      recordExperienceJourney(manifest, next, {
        watchedMedia: [{ ...media, watchedUntilMs: 1000 }],
      })
    ).toBe(next);
    expect(
      recordExperienceJourney(manifest, next, {
        watchedMedia: [{ ...media, watchedUntilMs: 5000 }],
      }).watchedMedia[0]!.watchedUntilMs
    ).toBe(5000);
    expect(() =>
      recordExperienceJourney(manifest, next, { watchedMedia: [{ ...media, sequenceIndex: 9 }] })
    ).toThrow(/unknown clip/);
  });
  it("rejects incompatible playback, corrupted variables and replay of nodes without an anchor", () => {
    const { manifest, state, playback } = fixture();
    expect(() =>
      createExperienceJourneyAnchor(manifest, {
        state,
        events: [],
        playback: { ...playback, sceneSignature: "old" },
      })
    ).toThrow(/no longer matches/);
    const anchor = createExperienceJourneyAnchor(manifest, { state, events: [], playback });
    const journey = recordExperienceJourney(manifest, createExperienceJourney(manifest), {
      anchor,
    });
    const corrupt = structuredClone(journey);
    (corrupt.anchors[0]!.state.values as { session: Record<string, unknown> }).session.count =
      "bad";
    expect(() =>
      restoreExperienceJourneyAnchor(manifest, corrupt, "one", { canAccess: () => true })
    ).toThrow();
    expect(() =>
      restoreExperienceJourneyAnchor(manifest, createExperienceJourney(manifest), "one", {
        canAccess: () => true,
      })
    ).toThrow(/no replayable entry save/);
  });
  it("rechecks paid ancestor routes when replaying a later public node", () => {
    const { manifest, state } = fixture();
    const one = manifest.graph.nodes[0]!;
    delete one.access;
    one.eventBindings.push({
      bindingId: "paid",
      on: { type: "choice.selected" },
      routes: [
        {
          routeId: "go",
          access: { key: "paid:branch", communityPointPrice: 20, title: { "en-US": "Branch" } },
          actions: [{ kind: "scene.goto", sceneId: "two" }],
        },
      ],
    });
    const two = {
      ...structuredClone(one),
      sceneId: "two",
      eventBindings: [
        {
          bindingId: "free",
          on: { type: "choice.selected" },
          routes: [{ routeId: "go", actions: [{ kind: "scene.goto", sceneId: "three" }] }],
        },
      ],
    } as typeof one;
    const three = { ...structuredClone(one), sceneId: "three", eventBindings: [] };
    manifest.graph.nodes.push(two, three);
    let journey = recordExperienceJourney(manifest, createExperienceJourney(manifest), {
      anchor: createExperienceJourneyAnchor(manifest, { state, events: [] }),
    });
    journey = recordExperienceJourney(manifest, journey, {
      effects: [
        {
          kind: "scene.changed",
          fromSceneId: "one",
          toSceneId: "two",
          bindingId: "paid",
          routeId: "go",
        },
      ],
      anchor: createExperienceJourneyAnchor(manifest, {
        state: { ...state, currentSceneId: "two" },
        events: [],
      }),
    });
    journey = recordExperienceJourney(manifest, journey, {
      effects: [
        {
          kind: "scene.changed",
          fromSceneId: "two",
          toSceneId: "three",
          bindingId: "free",
          routeId: "go",
        },
      ],
      anchor: createExperienceJourneyAnchor(manifest, {
        state: { ...state, currentSceneId: "three" },
        events: [],
      }),
    });
    expect(() =>
      restoreExperienceJourneyAnchor(manifest, journey, "three", { canAccess: () => false })
    ).toThrow(/unlock required/);
    expect(
      restoreExperienceJourneyAnchor(manifest, journey, "three", { canAccess: () => true }).state
        .currentSceneId
    ).toBe("three");
  });
});
