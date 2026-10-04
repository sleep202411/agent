import assert from "node:assert/strict";
import test from "node:test";
import {
  ExperienceStableIdSchema,
  parseExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import {
  advanceExperienceTimeline,
  assertExperienceRuntimeCompatibility,
  boundsOfExperienceProjectedGeometry,
  createExperienceDeterministicRuntimeState,
  createExperiencePressHoldState,
  createExperienceTimelineCursor,
  createMediaContentTransform,
  dispatchExperienceEvent,
  ExperienceRuntimeController,
  ExperienceRendererRegistry,
  hitTestExperienceGeometry,
  hitTestExperienceAnchor,
  initializeExperienceRuntime,
  normalizedContentPointToViewport,
  projectExperienceGeometryToViewport,
  resolveExperienceAnchorGeometry,
  resolveExperienceAudioPlayback,
  runExperienceEventQueue,
  stepExperiencePressHold,
  stepExperiencePressHoldInRuntime,
  restoreExperienceRuntime,
  viewportPointToNormalizedContent,
} from "../dist/index.js";

const HASH = "a".repeat(64);

function localized(english, simplified, traditional = simplified) {
  return { "en-US": english, "zh-CN": simplified, "zh-HK": traditional };
}

function manifestFixture() {
  return parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "engine.test",
    buildId: "engine.build.1",
    contentVersion: "1.0.0",
    completionPolicy: "finite",
    metadata: { title: localized("Engine test", "引擎测试", "引擎測試") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.text"],
    },
    localization: {
      defaultLocale: "en-US",
      locales: ["en-US", "zh-CN", "zh-HK"],
    },
    stateDefinitions: [
      {
        key: "player.energy",
        valueType: "number",
        scope: "session",
        initialValue: 3,
        constraints: { minimum: 0, maximum: 5 },
        sensitive: false,
      },
      {
        key: "player.profile",
        valueType: "json",
        scope: "player",
        initialValue: {},
        sensitive: false,
      },
      {
        key: "scene.attempts",
        valueType: "number",
        scope: "scene",
        initialValue: 0,
        constraints: { minimum: 0 },
        sensitive: false,
      },
    ],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: "core.text",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.text"],
        outcomes: [],
        commands: [],
      },
    ],
    assets: [
      {
        assetId: "theme.config",
        kind: "data",
        sourceAssetId: "theme.config.source",
        sha256: HASH,
        uri: "/theme.json",
        mediaType: "application/json",
        format: "json",
      },
    ],
    theme: { themeId: "theme.test", apiVersion: "1.0.0", configAssetId: "theme.config" },
    telemetryDefinitions: [
      {
        eventName: "interaction.accepted",
        fields: [
          {
            field: "durationMs",
            valueType: "duration-ms",
            required: true,
            classification: "analytics",
          },
        ],
      },
    ],
    endings: [
      {
        endingId: "ending.done",
        title: localized("Done", "完成"),
        kind: "success",
      },
    ],
    graph: {
      entrySceneId: "scene.one",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.one",
          clock: { kind: "none" },
          renderers: [
            {
              instanceId: "text.one",
              rendererId: "core.text",
              layer: 0,
              config: { text: "One" },
              bindings: {},
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "advance.when-ready",
              on: { type: "interaction.completed", sourceId: "interaction.test" },
              routes: [
                {
                  routeId: "ready",
                  when: {
                    kind: "compare",
                    left: { kind: "state", path: "player.energy" },
                    operator: "at-least",
                    right: { kind: "literal", value: 2 },
                  },
                  actions: [
                    {
                      kind: "state.increment",
                      path: "player.energy",
                      amount: { kind: "literal", value: -1 },
                    },
                    {
                      kind: "state.set",
                      path: "player.profile.lastInput",
                      value: { kind: "event", path: "input" },
                    },
                    {
                      kind: "telemetry.emit",
                      eventName: "interaction.accepted",
                      payload: { durationMs: { kind: "event", path: "durationMs" } },
                    },
                    {
                      kind: "state.increment",
                      path: "scene.attempts",
                      amount: { kind: "literal", value: 1 },
                    },
                    { kind: "scene.goto", sceneId: "scene.two" },
                  ],
                },
              ],
            },
          ],
        },
        {
          kind: "scene",
          sceneId: "scene.two",
          clock: { kind: "none" },
          renderers: [
            {
              instanceId: "text.two",
              rendererId: "core.text",
              layer: 0,
              config: { text: "Two" },
              bindings: {},
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "finish.on-enter",
              on: { type: "scene.entered" },
              routes: [
                {
                  routeId: "finish",
                  actions: [{ kind: "ending.complete", endingId: "ending.done" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

test("dispatches one deterministic event route and preserves the previous state", () => {
  const manifest = manifestFixture();
  const initial = initializeExperienceRuntime(manifest);
  const result = dispatchExperienceEvent(manifest, initial, {
    type: "interaction.completed",
    sourceId: "interaction.test",
    payload: { input: "hold", durationMs: 1_650 },
  });

  assert.equal(initial.currentSceneId, "scene.one");
  assert.equal(initial.values.session["player.energy"], 3);
  assert.deepEqual(initial.values.player["player.profile"], {});
  assert.equal(result.state.currentSceneId, "scene.two");
  assert.equal(result.state.values.session["player.energy"], 2);
  assert.deepEqual(result.state.values.player["player.profile"], { lastInput: "hold" });
  assert.equal(result.state.values.scene["scene.attempts"], 0);
  assert.deepEqual(result.effects, [
    {
      kind: "telemetry.emit",
      eventName: "interaction.accepted",
      payload: { durationMs: 1_650 },
    },
    {
      kind: "scene.changed",
      fromSceneId: "scene.one",
      toSceneId: "scene.two",
      bindingId: "advance.when-ready",
      routeId: "ready",
    },
  ]);

  const finished = dispatchExperienceEvent(manifest, result.state, { type: "scene.entered" });
  assert.equal(finished.state.status, "completed");
  assert.equal(finished.state.completedEndingId, "ending.done");
});

test("restores scoped snapshots strictly without mutating the supplied values", () => {
  const manifest = manifestFixture();
  const initial = initializeExperienceRuntime(manifest);
  const snapshot = structuredClone(initial.values);
  snapshot.session["player.energy"] = 4;
  const restored = restoreExperienceRuntime(manifest, {
    currentSceneId: "scene.one",
    status: "active",
    values: snapshot,
    deterministicRuntime: initial.deterministicRuntime,
  });
  assert.equal(restored.values.session["player.energy"], 4);
  restored.values.session["player.energy"] = 2;
  assert.equal(snapshot.session["player.energy"], 4);

  const wrongScope = structuredClone(snapshot);
  wrongScope.player["player.energy"] = wrongScope.session["player.energy"];
  delete wrongScope.session["player.energy"];
  assert.throws(
    () =>
      restoreExperienceRuntime(manifest, {
        currentSceneId: "scene.one",
        status: "active",
        values: wrongScope,
        deterministicRuntime: initial.deterministicRuntime,
      }),
    { code: "RESTORE_STATE_SCOPE" }
  );
});

test("emits ordered timeline cues once across rewind and replay", () => {
  const scene = {
    kind: "scene",
    sceneId: "scene.timeline",
    clock: { kind: "fixed", durationMs: 500 },
    renderers: [],
    anchors: [],
    gestures: [],
    timeline: {
      cues: [
        { cueId: "cue.one", atMs: 100, once: true },
        { cueId: "cue.two", atMs: 200, once: true },
      ],
    },
    eventBindings: [],
  };
  const first = advanceExperienceTimeline(
    scene,
    createExperienceTimelineCursor(scene.sceneId),
    150
  );
  assert.deepEqual(
    first.events.map((event) => event.qualifierId),
    ["cue.one"]
  );
  const rewound = advanceExperienceTimeline(scene, first.cursor, 50);
  assert.deepEqual(rewound.events, []);
  const replayed = advanceExperienceTimeline(scene, rewound.cursor, 250);
  assert.deepEqual(
    replayed.events.map((event) => event.qualifierId),
    ["cue.two"]
  );
});

test("uses one media transform for drawing and hit testing under cover crop", () => {
  const transform = createMediaContentTransform(
    { width: 1_000, height: 1_000 },
    { width: 1_920, height: 1_080 },
    "cover"
  );
  const normalizedCenter = { x: 0.72, y: 0.39 };
  const drawnCenter = normalizedContentPointToViewport(normalizedCenter, transform);
  const recoveredCenter = viewportPointToNormalizedContent(drawnCenter, transform);
  assert.ok(Math.abs(recoveredCenter.x - normalizedCenter.x) < 1e-10);
  assert.ok(Math.abs(recoveredCenter.y - normalizedCenter.y) < 1e-10);

  const geometry = {
    kind: "ellipse",
    bounds: { x: 0.67, y: 0.3, width: 0.1, height: 0.18 },
  };
  assert.equal(hitTestExperienceGeometry(geometry, drawnCenter, transform), true);
  assert.equal(hitTestExperienceGeometry(geometry, { x: 100, y: 100 }, transform), false);
});

test("interpolates keyframed anchors in source-content coordinates", () => {
  const geometry = resolveExperienceAnchorGeometry(
    {
      anchorId: "anchor.moving",
      space: { kind: "viewport" },
      geometry: {
        default: { kind: "rect", rect: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } },
      },
      motion: {
        kind: "keyframes",
        keyframes: [
          {
            atMs: 0,
            geometry: {
              default: {
                kind: "rect",
                rect: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
              },
            },
            easing: "linear",
          },
          {
            atMs: 1_000,
            geometry: {
              default: {
                kind: "rect",
                rect: { x: 0.5, y: 0.3, width: 0.2, height: 0.2 },
              },
            },
            easing: "linear",
          },
        ],
      },
    },
    "landscape",
    500
  );
  assert.equal(geometry.kind, "rect");
  assert.ok(Math.abs(geometry.rect.x - 0.3) < 1e-10);
  assert.ok(Math.abs(geometry.rect.y - 0.2) < 1e-10);
  assert.ok(Math.abs(geometry.rect.width - 0.15) < 1e-10);
  assert.ok(Math.abs(geometry.rect.height - 0.15) < 1e-10);
});

test("projects visible spatial geometry through the same cropped media transform as hit testing", () => {
  const transform = createMediaContentTransform(
    { width: 1_000, height: 1_000 },
    { width: 1_920, height: 1_080 },
    "cover"
  );
  const projected = projectExperienceGeometryToViewport(
    {
      kind: "ellipse",
      bounds: { x: 0.67, y: 0.3, width: 0.1, height: 0.18 },
    },
    transform
  );
  assert.equal(projected.kind, "ellipse");
  const bounds = boundsOfExperienceProjectedGeometry(projected);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  assert.equal(
    hitTestExperienceGeometry(
      { kind: "ellipse", bounds: { x: 0.67, y: 0.3, width: 0.1, height: 0.18 } },
      center,
      transform
    ),
    true
  );
});

test("advances, cancels, decays, and completes a press-hold gesture deterministically", () => {
  const gesture = {
    gestureId: "gesture.hold",
    anchorId: "anchor.target",
    inputActionId: "interact.primary",
    kind: "press-hold",
    durationMs: 1_600,
    releaseBehavior: "decay",
    decayPerSecond: 1,
    cancelOnPointerExit: true,
  };
  const half = stepExperiencePressHold(gesture, createExperiencePressHoldState(), {
    pressed: true,
    pointerInside: true,
    deltaMs: 800,
  });
  assert.equal(half.state.progress, 0.5);
  assert.deepEqual(half.signals, ["started"]);

  const released = stepExperiencePressHold(gesture, half.state, {
    pressed: false,
    pointerInside: true,
    deltaMs: 250,
  });
  assert.equal(released.state.progress, 0.25);
  assert.deepEqual(released.signals, ["cancelled"]);

  const completed = stepExperiencePressHold(gesture, released.state, {
    pressed: true,
    pointerInside: true,
    deltaMs: 1_600,
  });
  assert.equal(completed.state.progress, 1);
  assert.equal(completed.state.status, "completed");
  assert.deepEqual(completed.signals, ["started", "completed"]);
});

test("gates press-hold by scene time and latches pointer-exit cancellation until release", () => {
  const manifest = manifestFixture();
  const runtimeState = initializeExperienceRuntime(manifest);
  const gesture = {
    gestureId: "gesture.windowed",
    anchorId: "anchor.target",
    inputActionId: "interact.primary",
    kind: "press-hold",
    durationMs: 500,
    releaseBehavior: "retain",
    cancelOnPointerExit: true,
    activeWindow: { startMs: 1_000, endMs: 2_000 },
    enabledWhen: {
      kind: "compare",
      left: { kind: "state", path: "player.energy" },
      operator: "at-least",
      right: { kind: "literal", value: 3 },
    },
  };
  const unavailable = stepExperiencePressHoldInRuntime(
    gesture,
    createExperiencePressHoldState(),
    { pressed: true, pointerInside: true, deltaMs: 250 },
    { state: runtimeState, sceneTimeMs: 900 }
  );
  assert.equal(unavailable.state.progress, 0);
  assert.equal(unavailable.state.blockedUntilRelease, true);

  const released = stepExperiencePressHold(gesture, unavailable.state, {
    pressed: false,
    pointerInside: true,
    deltaMs: 0,
  });
  const charging = stepExperiencePressHoldInRuntime(
    gesture,
    released.state,
    { pressed: true, pointerInside: true, deltaMs: 250 },
    { state: runtimeState, sceneTimeMs: 1_200 }
  );
  assert.equal(charging.state.progress, 0.5);

  const exited = stepExperiencePressHold(gesture, charging.state, {
    pressed: true,
    pointerInside: false,
    deltaMs: 16,
  });
  assert.equal(exited.state.blockedUntilRelease, true);
  const reentered = stepExperiencePressHold(gesture, exited.state, {
    pressed: true,
    pointerInside: true,
    deltaMs: 500,
  });
  assert.equal(reentered.state.progress, 0.5);
  assert.deepEqual(reentered.signals, []);
});

test("drains emitted events in one bounded queue and hides internal emit effects", () => {
  const manifest = manifestFixture();
  const scene = manifest.graph.nodes.find((node) => node.sceneId === "scene.one");
  scene.eventBindings.push(
    {
      bindingId: "queue.start",
      on: { type: "queue.started" },
      routes: [
        {
          routeId: "queue.emit-next",
          actions: [{ kind: "event.emit", eventType: "queue.followed", payload: {} }],
        },
      ],
    },
    {
      bindingId: "queue.follow",
      on: { type: "queue.followed" },
      routes: [
        {
          routeId: "queue.update-state",
          actions: [
            {
              kind: "state.set",
              path: "player.energy",
              value: { kind: "literal", value: 5 },
            },
          ],
        },
      ],
    }
  );
  const result = runExperienceEventQueue(manifest, initializeExperienceRuntime(manifest), [
    { type: "queue.started" },
  ]);
  assert.equal(result.processedEventCount, 2);
  assert.equal(result.state.values.session["player.energy"], 5);
  assert.deepEqual(result.effects, []);

  scene.eventBindings.push({
    bindingId: "queue.loop",
    on: { type: "queue.looped" },
    routes: [
      {
        routeId: "queue.loop-again",
        actions: [{ kind: "event.emit", eventType: "queue.looped", payload: {} }],
      },
    ],
  });
  assert.throws(
    () =>
      runExperienceEventQueue(
        manifest,
        initializeExperienceRuntime(manifest),
        [{ type: "queue.looped" }],
        { maxProcessedEvents: 3 }
      ),
    { code: "EVENT_QUEUE_BUDGET_EXCEEDED" }
  );
});

test("fails compatibility and renderer validation before playback starts", () => {
  const manifest = manifestFixture();
  assert.throws(
    () =>
      assertExperienceRuntimeCompatibility(manifest, {
        engineApiVersion: "2.0.0",
        experienceApiVersion: "1.0.0",
        capabilities: new Set(),
      }),
    { code: "CAPABILITY_UNSUPPORTED" }
  );

  const registry = new ExperienceRendererRegistry();
  registry.register({
    rendererId: "core.text",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    capabilities: new Set(["core.text"]),
    supportsCommand: () => false,
    supportsOutcome: () => false,
    assertConfig(config) {
      if (typeof config.text !== "string") throw new Error("text config is required");
    },
    assertCommand() {},
    assertOutcome() {},
  });
  registry.assertManifest(manifest);
  const scene = manifest.graph.nodes.find((node) => node.sceneId === "scene.one");
  scene.renderers[0].config = {};
  assert.throws(() => registry.assertManifest(manifest), /text config is required/);
});

test("settles scene-entry routes after navigation in the shared queue", () => {
  const manifest = manifestFixture();
  const result = runExperienceEventQueue(manifest, initializeExperienceRuntime(manifest), [
    {
      type: "interaction.completed",
      sourceId: "interaction.test",
      payload: { input: "hold", durationMs: 1_650 },
    },
  ]);

  assert.equal(result.processedEventCount, 2);
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.completedEndingId, "ending.done");
  assert.deepEqual(
    result.effects.map((effect) => effect.kind),
    ["telemetry.emit", "scene.changed", "ending.completed"]
  );
});

test("starts a fresh controller once and rejects entry replay", () => {
  const manifest = manifestFixture();
  const registry = new ExperienceRendererRegistry();
  registry.register({
    rendererId: "core.text",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    capabilities: new Set(["core.text"]),
    supportsCommand: () => false,
    supportsOutcome: () => false,
    assertConfig() {},
    assertCommand() {},
    assertOutcome() {},
  });
  const controller = new ExperienceRuntimeController(manifest, {
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      capabilities: new Set(["core.text"]),
    },
    rendererRegistry: registry,
  });

  assert.throws(() => controller.dispatch([]), { code: "RUNTIME_NOT_STARTED" });
  assert.equal(controller.start().state.currentSceneId, "scene.one");
  assert.throws(() => controller.start(), { code: "RUNTIME_ALREADY_STARTED" });
});

test("resolves random and sequential audio deterministically from persisted cursors", () => {
  const manifest = {
    audio: {
      cues: [
        {
          cueId: "cue.random",
          assetIds: ["audio.a", "audio.b", "audio.c"],
          selection: "random",
          playbackRate: { minimum: 0.9, maximum: 1.1 },
        },
        {
          cueId: "cue.sequence",
          assetIds: ["audio.a", "audio.b"],
          selection: "sequential",
          playbackRate: { minimum: 1, maximum: 1 },
        },
      ],
    },
  };
  const firstState = createExperienceDeterministicRuntimeState("session.seed");
  const secondState = createExperienceDeterministicRuntimeState("session.seed");
  const first = [
    resolveExperienceAudioPlayback(manifest, firstState, "cue.random"),
    resolveExperienceAudioPlayback(manifest, firstState, "cue.random"),
  ];
  const second = [
    resolveExperienceAudioPlayback(manifest, secondState, "cue.random"),
    resolveExperienceAudioPlayback(manifest, secondState, "cue.random"),
  ];
  assert.deepEqual(first, second);
  assert.equal(firstState.audioCuePlayCounts["cue.random"], 2);

  const sequenceState = createExperienceDeterministicRuntimeState();
  assert.equal(
    resolveExperienceAudioPlayback(manifest, sequenceState, "cue.sequence").assetId,
    "audio.a"
  );
  assert.equal(
    resolveExperienceAudioPlayback(manifest, sequenceState, "cue.sequence").assetId,
    "audio.b"
  );
  assert.throws(
    () =>
      resolveExperienceAudioPlayback(
        manifest,
        createExperienceDeterministicRuntimeState(),
        "cue.random"
      ),
    { code: "RANDOM_SEED_REQUIRED" }
  );
});

test("uses anchor coordinate space centrally and includes every polygon boundary", () => {
  const transform = createMediaContentTransform(
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    "contain"
  );
  const anchor = {
    anchorId: "anchor.polygon",
    space: { kind: "renderer-content", rendererInstanceId: "video.one" },
    geometry: {
      default: {
        kind: "polygon",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      },
    },
    motion: { kind: "fixed" },
  };
  const input = {
    orientation: "square",
    atMs: 0,
    viewportSize: { width: 100, height: 100 },
    rendererContentTransforms: new Map([["video.one", transform]]),
  };
  for (const viewportPoint of [
    { x: 20, y: 50 },
    { x: 80, y: 50 },
    { x: 50, y: 20 },
    { x: 50, y: 80 },
  ]) {
    assert.equal(hitTestExperienceAnchor(anchor, { ...input, viewportPoint }), true);
  }
});

test("defensively rejects reserved state paths without polluting Object.prototype", () => {
  const manifest = manifestFixture();
  const scene = manifest.graph.nodes.find((node) => node.sceneId === "scene.one");
  const action = scene.eventBindings[0].routes[0].actions[1];
  action.path = "player.profile.__proto__.polluted";
  assert.throws(
    () =>
      dispatchExperienceEvent(manifest, initializeExperienceRuntime(manifest), {
        type: "interaction.completed",
        sourceId: "interaction.test",
        payload: { input: "hold", durationMs: 1_650 },
      }),
    { code: "STATE_PATH_RESERVED" }
  );
  assert.equal({}.polluted, undefined);
});

test("repeated polygon vertices do not turn the whole viewport into a hit target", () => {
  const transform = createMediaContentTransform(
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    "contain"
  );
  const points = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];
  for (const repeated of [
    [...points, points[0]],
    [points[0], ...points],
  ]) {
    const geometry = { kind: "polygon", points: repeated };
    assert.equal(hitTestExperienceGeometry(geometry, { x: 5, y: 5 }, transform), false);
    assert.equal(hitTestExperienceGeometry(geometry, { x: 50, y: 50 }, transform), true);
    assert.equal(hitTestExperienceGeometry(geometry, { x: 20, y: 20 }, transform), true);
  }
});

test("very short polygon edges retain a distance-based boundary tolerance", () => {
  const transform = createMediaContentTransform(
    { width: 100, height: 100 },
    { width: 100, height: 100 },
    "contain"
  );
  const geometry = {
    kind: "polygon",
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.2000000001, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ],
  };
  assert.equal(hitTestExperienceGeometry(geometry, { x: 90, y: 10 }, transform), false);
  assert.equal(hitTestExperienceGeometry(geometry, { x: 20, y: 50 }, transform), true);
});

test("audio cue counters survive JSON restoration without inherited ID collisions", () => {
  for (const cueId of ["constructor", "toString", "hasOwnProperty"]) {
    assert.equal(ExperienceStableIdSchema.parse(cueId), cueId);
    const manifest = {
      audio: {
        cues: [
          {
            cueId,
            assetIds: ["audio.a", "audio.b"],
            selection: "sequential",
            playbackRate: { minimum: 1, maximum: 1 },
          },
        ],
      },
    };
    let state = JSON.parse(JSON.stringify(createExperienceDeterministicRuntimeState()));
    const first = resolveExperienceAudioPlayback(manifest, state, cueId);
    assert.equal(first.assetId, "audio.a");
    assert.equal(first.playbackOrdinal, 0);
    state = JSON.parse(JSON.stringify(state));
    const second = resolveExperienceAudioPlayback(manifest, state, cueId);
    assert.equal(second.assetId, "audio.b");
    assert.equal(second.playbackOrdinal, 1);
    assert.equal(state.audioCuePlayCounts[cueId], 2);
  }
});

test("reports a fast ending after delayed session creation, in progress/completion order", async () => {
  let resolveStart;
  const pendingStart = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const events = [];
  const registry = new ExperienceRendererRegistry();
  registry.register({
    rendererId: "core.text",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    capabilities: new Set(["core.text"]),
    supportsCommand: () => false,
    supportsOutcome: () => false,
    assertConfig() {},
    assertCommand() {},
    assertOutcome() {},
  });
  const controller = new ExperienceRuntimeController(manifestFixture(), {
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      capabilities: new Set(["core.text"]),
    },
    rendererRegistry: registry,
    playSessionReporter: {
      onStart: () => pendingStart,
      onProgress: async (sessionId, payload) => {
        events.push(["progress", sessionId, payload]);
      },
      onComplete: async (sessionId, payload) => {
        events.push(["complete", sessionId, payload]);
      },
    },
  });
  controller.start();
  const result = controller.dispatch([
    {
      type: "interaction.completed",
      sourceId: "interaction.test",
      payload: { input: "hold", durationMs: 1650 },
    },
  ]);
  assert.equal(result.state.status, "completed");
  resolveStart({ sessionId: "session.delayed" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    ["progress", "session.delayed", { currentNode: "scene.two" }],
    ["complete", "session.delayed", { endingId: "ending.done", currentNode: "scene.two" }],
  ]);
});

function reportingController(reporter, restore) {
  const registry = new ExperienceRendererRegistry();
  registry.register({
    rendererId: "core.text",
    apiVersion: "1.0.0",
    configSchemaVersion: "1.0.0",
    capabilities: new Set(["core.text"]),
    supportsCommand: () => false,
    supportsOutcome: () => false,
    assertConfig() {},
    assertCommand() {},
    assertOutcome() {},
  });
  return new ExperienceRuntimeController(manifestFixture(), {
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      capabilities: new Set(["core.text"]),
    },
    rendererRegistry: registry,
    playSessionReporter: reporter,
    restore,
  });
}
const finishReportingFilm = (controller) =>
  controller.dispatch([
    {
      type: "interaction.completed",
      sourceId: "interaction.test",
      payload: { input: "hold", durationMs: 1650 },
    },
  ]);
const flushReports = () => new Promise((resolve) => setImmediate(resolve));

test("replay ignores old browser session IDs and registers a new reporting transport", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => "old-completed-session" },
  });
  let starts = 0;
  try {
    const reporter = {
      onStart: async () => ({ sessionId: `new-${++starts}` }),
      onProgress: async () => {},
      onComplete: async () => {},
    };
    for (let n = 1; n <= 2; n++) {
      const controller = reportingController(reporter);
      controller.start();
      finishReportingFilm(controller);
      await flushReports();
      assert.equal(controller.getCompletedPlaySessionId(), `new-${n}`);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else delete globalThis.sessionStorage;
  }
});

test("checkpoint continuation starts reporting without replaying scene entry", async () => {
  const snapshot = initializeExperienceRuntime(manifestFixture());
  let starts = 0;
  const controller = reportingController(
    {
      onStart: async () => {
        starts++;
        return { sessionId: "resumed" };
      },
      onProgress: async () => {},
      onComplete: async () => {},
    },
    snapshot
  );
  finishReportingFilm(controller);
  await flushReports();
  assert.equal(starts, 1);
  assert.equal(controller.getCompletedPlaySessionId(), "resumed");
  assert.equal(controller.state().values.session["player.energy"], 2);
});

test("notifies the ending report subscriber only after completion is saved", async () => {
  let complete;
  const completion = new Promise((resolve) => {
    complete = resolve;
  });
  const controller = reportingController({
    onStart: async () => ({ sessionId: "saved" }),
    onProgress: async () => {},
    onComplete: () => completion,
  });
  let notifications = 0;
  const unsubscribe = controller.subscribePlaySessionReport(() => {
    notifications++;
  });
  controller.start();
  finishReportingFilm(controller);
  await flushReports();
  assert.equal(controller.getCompletedPlaySessionId(), null);
  assert.equal(notifications, 0);
  complete();
  await flushReports();
  assert.equal(controller.getCompletedPlaySessionId(), "saved");
  assert.equal(notifications, 1);
  unsubscribe();
});
