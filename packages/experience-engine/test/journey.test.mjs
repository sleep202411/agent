import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExperienceRuntimeManifest,
  ExperienceStableIdSchema,
} from "@repo/shared/experience-runtime";
import {
  applyExperienceJourneyDelta,
  createExperienceJourney,
  diffExperienceJourney,
  experienceJourneySignature,
  ExperienceAccessRequiredError,
  ExperienceRendererRegistry,
  ExperienceRuntimeController,
  EXPERIENCE_CORE_RENDERER_ADAPTERS,
  initializeExperienceRuntime,
  projectExperienceJourneyGraph,
  getExperienceJourneyReplayAccess,
  experienceJourneyEndingNodeId,
  getExperienceJourneyActiveAccess,
  rewindExperienceJourney,
  recordExperienceJourney,
  validateExperienceJourney,
} from "../dist/index.js";

const entered = (sceneId) => ({ type: "scene.entered", sourceId: sceneId, payload: {} });
const binding = (bindingId, type, actions) => ({
  bindingId,
  on: { type },
  routes: [{ routeId: "go", actions }],
});
const goto = (sceneId) => ({ kind: "scene.goto", sceneId });
const setTarget = (value) => ({
  kind: "state.set",
  path: "target",
  value: { kind: "literal", value },
});
const text = (id) => ({
  instanceId: `${id}.text`,
  rendererId: "core.text",
  layer: 0,
  config: { body: { "en-US": id }, completion: "passive" },
  bindings: {},
});

function fixture({ paid = false } = {}) {
  return parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "journey",
    buildId: "one",
    contentVersion: "one",
    completionPolicy: "open-ended",
    metadata: { title: { "en-US": "Journey" } },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.text", ...(paid ? ["commerce.community-points"] : [])],
    },
    assets: [
      {
        assetId: "theme",
        kind: "data",
        sourceAssetId: "theme",
        sha256: "a".repeat(64),
        uri: "/theme.json",
        mediaType: "application/json",
        format: "json",
      },
    ],
    theme: { themeId: "theme", apiVersion: "1.0.0", configAssetId: "theme" },
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
    stateDefinitions: [
      { key: "count", valueType: "number", scope: "session", initialValue: 0 },
      { key: "target", valueType: "string", scope: "session", initialValue: "D" },
    ],
    endings: [{ endingId: "done", title: { "en-US": "Done" }, kind: "success" }],
    graph: {
      entrySceneId: "A",
      nodes: [
        {
          kind: "scene",
          sceneId: "A",
          renderers: [text("A")],
          eventBindings: [
            binding("entry", "scene.entered", [
              { kind: "state.increment", path: "count", amount: { kind: "literal", value: 1 } },
            ]),
            binding("a", "choice.selected", [setTarget("D"), goto("R")]),
            binding("finish", "story.finish", [{ kind: "ending.complete", endingId: "done" }]),
          ],
        },
        {
          kind: "router",
          sceneId: "R",
          eventBindings: [
            {
              bindingId: "route",
              on: { type: "scene.entered" },
              routes: [
                {
                  routeId: "b",
                  when: {
                    kind: "compare",
                    left: { kind: "state", path: "target" },
                    operator: "equals",
                    right: { kind: "literal", value: "B" },
                  },
                  actions: [goto("B")],
                },
                { routeId: "d", actions: [goto("D")] },
              ],
            },
          ],
        },
        {
          kind: "scene",
          sceneId: "D",
          renderers: [text("D")],
          eventBindings: [binding("to-c", "choice.selected", [goto("C")])],
        },
        {
          kind: "scene",
          sceneId: "C",
          renderers: [text("C")],
          eventBindings: [binding("c", "choice.selected", [setTarget("B"), goto("R")])],
        },
        {
          kind: "scene",
          sceneId: "B",
          renderers: [text("B")],
          ...(paid
            ? { access: { key: "paid:B", communityPointPrice: 20, title: { "en-US": "Paid" } } }
            : {}),
          eventBindings: [binding("back", "choice.selected", [goto("A")])],
        },
      ],
    },
  });
}

function controller(manifest, options = {}) {
  const rendererRegistry = new ExperienceRendererRegistry();
  EXPERIENCE_CORE_RENDERER_ADAPTERS.forEach((adapter) => rendererRegistry.register(adapter));
  return new ExperienceRuntimeController(manifest, {
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      capabilities: new Set(["core.text", "commerce.community-points"]),
    },
    rendererRegistry,
    ...options,
  });
}
function record(manifest, journey, result) {
  return recordExperienceJourney(manifest, journey, {
    sceneId: result.state.currentSceneId,
    effects: result.effects,
    ...(result.state.status === "active"
      ? { anchor: { sceneId: result.state.currentSceneId, state: result.state, events: [] } }
      : {}),
  });
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("records the selected routes, preserves loops and does not invent router merge paths", () => {
  const manifest = fixture();
  const runtime = controller(manifest);
  let journey = record(manifest, createExperienceJourney(manifest), runtime.start());
  for (let index = 0; index < 4; index++)
    journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  const map = projectExperienceJourneyGraph(manifest, journey);
  assert.equal(
    map.nodes.some((node) => node.sceneId === "R"),
    false
  );
  assert.equal(
    map.edges.find((edge) => edge.fromSceneId === "A" && edge.toSceneId === "D").traversed,
    true
  );
  assert.equal(
    map.edges.find((edge) => edge.fromSceneId === "C" && edge.toSceneId === "B").traversed,
    true
  );
  assert.equal(
    map.edges.find((edge) => edge.fromSceneId === "A" && edge.toSceneId === "B").traversed,
    false
  );
  assert.equal(
    map.edges.find((edge) => edge.fromSceneId === "B" && edge.toSceneId === "A").traversed,
    true
  );
  assert.equal(journey.anchors.filter((entry) => entry.sceneId === "A").length, 1);
  assert.equal(
    journey.anchors.find((entry) => entry.sceneId === "A").state.values.session.count,
    2
  );
  assert.deepEqual(
    validateExperienceJourney(manifest, JSON.parse(JSON.stringify(journey))),
    journey
  );
});

test("a refused queue leaves state and exploration unchanged", () => {
  const manifest = fixture({ paid: true });
  const runtime = controller(manifest, { canAccess: () => false });
  let journey = record(manifest, createExperienceJourney(manifest), runtime.start());
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  const state = runtime.state();
  const before = structuredClone(journey);
  assert.throws(
    () => runtime.dispatch([{ type: "choice.selected" }]),
    ExperienceAccessRequiredError
  );
  assert.deepEqual(runtime.state(), state);
  assert.deepEqual(journey, before);
  assert.equal(
    journey.traversedEdges.some((edge) => edge.toSceneId === "B"),
    false
  );
});

test("diff sends only new records and upserted entries, and unchanged progress keeps reference", () => {
  const manifest = fixture();
  const runtime = controller(manifest);
  const base = record(manifest, createExperienceJourney(manifest), runtime.start());
  assert.equal(recordExperienceJourney(manifest, base, { sceneId: "A" }), base);
  const next = record(manifest, base, runtime.dispatch([{ type: "choice.selected" }]));
  const delta = diffExperienceJourney(base, next);
  assert.deepEqual(
    delta.anchors.map((anchor) => anchor.sceneId),
    ["D"]
  );
  assert.equal(next.anchors[0], base.anchors[0]);
  assert.deepEqual(applyExperienceJourneyDelta(base, delta), next);
  assert.equal(diffExperienceJourney(next, next), undefined);
  const changed = structuredClone(manifest);
  changed.graph.entrySceneId = "C";
  const fresh = createExperienceJourney(changed);
  const reset = diffExperienceJourney(next, fresh);
  assert.throws(() => applyExperienceJourneyDelta(next, reset), /signature changed/);
  assert.deepEqual(
    applyExperienceJourneyDelta(next, reset, { resetOnSignatureChange: true }),
    fresh
  );
});

test("compatibility ignores published media URLs and object key order but detects story changes", () => {
  const manifest = fixture();
  const republished = structuredClone(manifest);
  republished.assets[0].uri = "https://example.com/new-build/theme.json";
  republished.buildId = "new";
  republished.contentVersion = "new";
  republished.graph = {
    nodes: republished.graph.nodes,
    entrySceneId: republished.graph.entrySceneId,
  };
  assert.equal(experienceJourneySignature(republished), experienceJourneySignature(manifest));
  const changed = structuredClone(republished);
  changed.stateDefinitions[0].initialValue = 4;
  assert.notEqual(experienceJourneySignature(changed), experienceJourneySignature(manifest));
  assert.throws(
    () => validateExperienceJourney(changed, createExperienceJourney(manifest)),
    /no longer matches/
  );
});

test("restore rechecks access and restores variables without rerunning entry side effects", () => {
  const manifest = fixture({ paid: true });
  let allowed = true;
  const runtime = controller(manifest, { canAccess: () => allowed });
  const entry = runtime.start().state;
  for (let index = 0; index < 3; index++) runtime.dispatch([{ type: "choice.selected" }]);
  const paid = runtime.state();
  allowed = false;
  assert.throws(() => runtime.restore(paid), ExperienceAccessRequiredError);
  assert.deepEqual(runtime.state(), paid);
  assert.equal(runtime.restore(entry).values.session.count, 1);
  assert.throws(() => runtime.start(), /already started/);
  assert.equal(runtime.dispatch([{ type: "unhandled" }]).state.values.session.count, 1);
});

test("old async completion cannot replace a new branch report session after restore", async () => {
  const manifest = fixture();
  let resolveOld;
  const oldCompletion = new Promise((resolve) => {
    resolveOld = resolve;
  });
  let starts = 0;
  const completions = [];
  const runtime = controller(manifest, {
    playSessionReporter: {
      onStart: async () => ({ sessionId: `session-${++starts}` }),
      onProgress: async () => {},
      onComplete: async (sessionId) => {
        completions.push(sessionId);
        if (sessionId === "session-1") await oldCompletion;
      },
    },
  });
  const entry = runtime.start().state;
  runtime.dispatch([{ type: "story.finish" }]);
  await tick();
  assert.deepEqual(completions, ["session-1"]);
  runtime.restore(entry);
  runtime.dispatch([{ type: "unhandled" }]);
  await tick();
  assert.equal(runtime.playSessionId, "session-2");
  resolveOld();
  await tick();
  assert.equal(runtime.getCompletedPlaySessionId(), null);
  runtime.dispatch([{ type: "story.finish" }]);
  await tick();
  assert.equal(runtime.getCompletedPlaySessionId(), "session-2");
  assert.deepEqual(completions, ["session-1", "session-2"]);
});

test("transparent empty scenes are collapsed and router cycles terminate", () => {
  const manifest = fixture();
  manifest.graph.nodes.find((node) => node.sceneId === "D").renderers = [];
  manifest.graph.nodes
    .find((node) => node.sceneId === "R")
    .eventBindings[0].routes.push({ routeId: "loop", actions: [goto("R")] });
  const graph = projectExperienceJourneyGraph(manifest, createExperienceJourney(manifest));
  assert.equal(
    graph.nodes.some((node) => node.sceneId === "D" || node.sceneId === "R"),
    false
  );
  assert.equal(
    graph.edges.some((edge) => edge.fromSceneId === "A" && edge.toSceneId === "C"),
    true
  );
  assert.equal(graph.truncated, false);
});

test("incompatible, recursive and malformed restore anchors are rejected", () => {
  const manifest = fixture();
  const state = initializeExperienceRuntime(manifest);
  const valid = recordExperienceJourney(manifest, createExperienceJourney(manifest), {
    anchor: { sceneId: "A", state, events: [] },
  });
  const nested = structuredClone(valid);
  nested.anchors[0].journey = valid;
  assert.throws(() => validateExperienceJourney(manifest, nested));
  const wrongState = structuredClone(valid);
  wrongState.anchors[0].state.values.session.count = "wrong";
  assert.throws(() => validateExperienceJourney(manifest, wrongState));
  const disconnected = structuredClone(valid);
  disconnected.traversedPaths.push([
    { fromSceneId: "A", bindingId: "a", routeId: "go", toSceneId: "R" },
  ]);
  assert.throws(() => validateExperienceJourney(manifest, disconnected), /disconnected path/);
});

test("ancestors' paid route requirements remain attached to later public scene entries", () => {
  const manifest = fixture();
  const a = manifest.graph.nodes.find((node) => node.sceneId === "A");
  a.eventBindings.find((entry) => entry.bindingId === "a").routes[0].access = {
    key: "paid:branch",
    communityPointPrice: 20,
    title: { "en-US": "Paid branch" },
  };
  manifest.compatibility.requiredCapabilities.push("commerce.community-points");
  const runtime = controller(manifest, { canAccess: () => true });
  let journey = record(manifest, createExperienceJourney(manifest), runtime.start());
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  assert.equal(runtime.state().currentSceneId, "C");
  assert.deepEqual(journey.anchors.find((anchor) => anchor.sceneId === "C").requiredAccessRefs, [
    { kind: "route", sceneId: "A", bindingId: "a", routeId: "go" },
  ]);
  assert.deepEqual(
    getExperienceJourneyReplayAccess(manifest, journey, "C").map((requirement) => requirement.key),
    ["paid:branch"]
  );
  assert.deepEqual(validateExperienceJourney(manifest, journey), journey);
});

test("a walked hidden router cycle still highlights its actual presentable branch", () => {
  const manifest = fixture();
  manifest.graph.nodes
    .find((node) => node.sceneId === "A")
    .eventBindings.find((entry) => entry.bindingId === "a").routes[0].actions[0] =
    setTarget("loop");
  manifest.graph.nodes
    .find((node) => node.sceneId === "R")
    .eventBindings[0].routes.unshift({
      routeId: "loop",
      when: {
        kind: "compare",
        left: { kind: "state", path: "target" },
        operator: "equals",
        right: { kind: "literal", value: "loop" },
      },
      actions: [setTarget("B"), goto("R")],
    });
  const runtime = controller(manifest);
  let journey = record(manifest, createExperienceJourney(manifest), runtime.start());
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  assert.equal(journey.traversedPaths[0].length, 3);
  const graph = projectExperienceJourneyGraph(manifest, journey);
  assert.equal(
    graph.edges.find((edge) => edge.fromSceneId === "A" && edge.toSceneId === "B").traversed,
    true
  );
  assert.equal(
    graph.edges.find((edge) => edge.fromSceneId === "A" && edge.toSceneId === "D").traversed,
    false
  );
});

test("synthetic ending IDs cannot collide with any real stable scene ID", () => {
  assert.equal(
    ExperienceStableIdSchema.safeParse(experienceJourneyEndingNodeId("done")).success,
    false
  );
  assert.equal(ExperienceStableIdSchema.safeParse("ending:done").success, true);
  const manifest = fixture();
  manifest.graph.nodes.push({
    ...structuredClone(manifest.graph.nodes[0]),
    sceneId: "ending:done",
    renderers: [text("ending:done")],
    eventBindings: [],
  });
  const graph = projectExperienceJourneyGraph(manifest, createExperienceJourney(manifest));
  assert.equal(graph.nodes.filter((node) => node.sceneId === "ending:done").length, 1);
  assert.equal(
    graph.nodes.filter((node) => node.sceneId === experienceJourneyEndingNodeId("done")).length,
    1
  );
});

test("non-navigation paid routes guard later public entries without locking the original public entry", () => {
  const manifest = fixture();
  manifest.compatibility.requiredCapabilities.push("commerce.community-points");
  manifest.graph.nodes
    .find((node) => node.sceneId === "A")
    .eventBindings.push({
      bindingId: "pay-state",
      on: { type: "paid.action" },
      routes: [
        {
          routeId: "update",
          access: { key: "paid:state", communityPointPrice: 20, title: { "en-US": "Paid action" } },
          actions: [
            { kind: "state.increment", path: "count", amount: { kind: "literal", value: 1 } },
          ],
        },
      ],
    });
  const runtime = controller(manifest, { canAccess: () => true });
  let journey = record(manifest, createExperienceJourney(manifest), runtime.start());
  const original = journey.anchors[0];
  const paid = runtime.dispatch([{ type: "paid.action" }]);
  assert.equal(
    paid.effects.some(
      (effect) =>
        effect.kind === "access.checked" &&
        effect.ref.kind === "route" &&
        effect.ref.bindingId === "pay-state"
    ),
    true
  );
  journey = recordExperienceJourney(manifest, journey, { sceneId: "A", effects: paid.effects });
  assert.equal(journey.anchors[0], original);
  assert.deepEqual(getExperienceJourneyReplayAccess(manifest, journey, "A"), []);
  assert.deepEqual(
    getExperienceJourneyActiveAccess(manifest, journey).map((requirement) => requirement.key),
    ["paid:state"]
  );
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  journey = record(manifest, journey, runtime.dispatch([{ type: "choice.selected" }]));
  assert.deepEqual(
    getExperienceJourneyReplayAccess(manifest, journey, "C").map((requirement) => requirement.key),
    ["paid:state"]
  );
  assert.deepEqual(validateExperienceJourney(manifest, journey), journey);
  const rewound = rewindExperienceJourney(journey, "A");
  assert.deepEqual(getExperienceJourneyActiveAccess(manifest, rewound), []);
  assert.equal(rewound.anchors, journey.anchors);
  assert.deepEqual(rewound.visitedNodeIds, journey.visitedNodeIds);
  assert.deepEqual(
    applyExperienceJourneyDelta(journey, diffExperienceJourney(journey, rewound)),
    rewound
  );
});

function largeJourney(count, textSize = 0) {
  const manifest = fixture();
  manifest.stateDefinitions.push({
    key: "payload",
    scope: "session",
    valueType: "json",
    initialValue: {},
    sensitive: false,
  });
  for (let index = 0; index < count; index++) {
    const sceneId = `scene-${index}`;
    manifest.graph.nodes.push({
      kind: "scene",
      sceneId,
      renderers: [text(sceneId)],
      clock: { kind: "none" },
      anchors: [],
      gestures: [],
      timeline: { cues: [] },
      eventBindings: [],
    });
  }
  const state = initializeExperienceRuntime(manifest);
  const journey = createExperienceJourney(manifest);
  for (let index = 0; index < count; index++) {
    const sceneId = `scene-${index}`;
    journey.visitedNodeIds.push(sceneId);
    journey.anchors.push({
      sceneId,
      state: {
        ...state,
        currentSceneId: sceneId,
        values: {
          ...state.values,
          session: { ...state.values.session, payload: { text: "a".repeat(textSize) } },
        },
      },
      events: [],
      requiredAccessRefs: [],
    });
  }
  return { manifest, journey: validateExperienceJourney(manifest, journey) };
}

test("more than 64 unacknowledged entry anchors recover through bounded chunks", () => {
  const { manifest, journey } = largeJourney(70);
  let acknowledged = null;
  let chunks = 0;
  while (true) {
    const delta = diffExperienceJourney(acknowledged, journey);
    if (!delta) break;
    assert.ok(delta.anchors.length <= 64);
    acknowledged = applyExperienceJourneyDelta(acknowledged, delta);
    assert.doesNotThrow(() => validateExperienceJourney(manifest, acknowledged));
    assert.ok(++chunks < 10);
  }
  assert.equal(chunks, 2);
  assert.deepEqual(acknowledged, journey);
});

test("snapshot backlog larger than 512 KiB preserves acknowledgements and finishes without full resend", () => {
  const { manifest, journey } = largeJourney(12, 100 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(journey)) > 512 * 1024);
  let acknowledged = null;
  const sentScenes = [];
  let chunks = 0;
  while (true) {
    const delta = diffExperienceJourney(acknowledged, journey);
    if (!delta) break;
    assert.ok(Buffer.byteLength(JSON.stringify(delta)) <= 512 * 1024);
    sentScenes.push(...delta.anchors.map((anchor) => anchor.sceneId));
    const prior = acknowledged?.anchors[0];
    acknowledged = applyExperienceJourneyDelta(acknowledged, delta);
    if (prior) assert.equal(acknowledged.anchors[0], prior);
    assert.doesNotThrow(() => validateExperienceJourney(manifest, acknowledged));
    assert.ok(++chunks < 10);
  }
  assert.ok(chunks > 1);
  assert.equal(new Set(sentScenes).size, journey.anchors.length);
  assert.equal(sentScenes.length, journey.anchors.length);
  assert.deepEqual(acknowledged, journey);
});

test("metadata also chunks while current gate references arrive with their dependencies", () => {
  const { manifest, journey } = largeJourney(3);
  const paidRoute = manifest.graph.nodes
    .find((node) => node.sceneId === "A")
    .eventBindings.find((entry) => entry.bindingId === "a").routes[0];
  paidRoute.access = { key: "paid:branch", communityPointPrice: 20, title: { "en-US": "Branch" } };
  // Changing a manifest requires a new identity, as production manifests are immutable.
  const updated = structuredClone(manifest);
  journey.signature = experienceJourneySignature(updated);
  journey.visitedNodeIds.push("A", "R");
  const edge = { fromSceneId: "A", bindingId: "a", routeId: "go", toSceneId: "R" };
  journey.traversedEdges.push(edge);
  journey.activeAccessRefs.push({ kind: "route", sceneId: "A", bindingId: "a", routeId: "go" });
  // Distinct valid bindings produce a large edge backlog without snapshots.
  const router = updated.graph.nodes.find((node) => node.sceneId === "R");
  for (let index = 0; index < 3000; index++) {
    const bindingId = `binding-${index}-${"x".repeat(130)}`;
    const synthetic = binding(bindingId, "routing.test", [goto("A")]);
    synthetic.on.sourceId = `source-${index}`;
    router.eventBindings.push(synthetic);
    journey.traversedEdges.push({ fromSceneId: "R", bindingId, routeId: "go", toSceneId: "A" });
  }
  const fresh = structuredClone(updated);
  journey.signature = experienceJourneySignature(fresh);
  const target = validateExperienceJourney(fresh, journey);
  let ack = null;
  let chunks = 0;
  while (true) {
    const delta = diffExperienceJourney(ack, target);
    if (!delta) break;
    assert.ok(Buffer.byteLength(JSON.stringify(delta)) <= 512 * 1024);
    ack = applyExperienceJourneyDelta(ack, delta);
    assert.doesNotThrow(() => validateExperienceJourney(fresh, ack));
    if (chunks === 0)
      assert.deepEqual(
        getExperienceJourneyActiveAccess(fresh, ack).map((requirement) => requirement.key),
        ["paid:branch"]
      );
    assert.ok(++chunks < 10);
  }
  assert.ok(chunks > 1);
  assert.deepEqual(ack, target);
});
