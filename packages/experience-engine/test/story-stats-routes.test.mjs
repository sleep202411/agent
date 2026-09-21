import assert from "node:assert/strict";
import test from "node:test";
import { parseExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import {
  initializeExperienceRuntime,
  runExperienceEventQueue,
} from "../dist/index.js";

const HASH = "a".repeat(64);

function localized(text) {
  return { "en-US": text, "zh-CN": text, "zh-HK": text };
}

test("compiled GAL stats: increment then threshold ending", () => {
  const manifest = parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "stats.test",
    buildId: "stats.build",
    contentVersion: "1",
    completionPolicy: "finite",
    metadata: { title: localized("Stats") },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.choice"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US", "zh-CN", "zh-HK"] },
    stateDefinitions: [
      {
        key: "favorability.lin",
        valueType: "number",
        scope: "session",
        initialValue: 0,
        sensitive: false,
      },
    ],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: "core.choice",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.choice"],
        outcomes: [{ outcomeType: "choice-selected" }],
        commands: [{ commandType: "open" }],
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
    telemetryDefinitions: [],
    endings: [
      {
        endingId: "ending.together",
        title: localized("Together"),
        kind: "success",
      },
    ],
    graph: {
      entrySceneId: "scene.gate",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.gate",
          clock: { kind: "none" },
          renderers: [
            {
              instanceId: "renderer:scene.gate:choice",
              rendererId: "core.choice",
              layer: 100,
              config: {
                decisionId: "gate",
                prompt: localized("Stay?"),
                choices: [
                  { choiceId: "gift", label: localized("Gift") },
                  { choiceId: "leave", label: localized("Leave") },
                ],
                initiallyOpen: true,
              },
              bindings: {},
            },
          ],
          eventBindings: [
            {
              bindingId: "binding:scene.gate:choice-selected",
              on: {
                type: "renderer.outcome",
                sourceId: "renderer:scene.gate:choice",
                qualifierId: "choice-selected",
              },
              routes: [
                {
                  routeId: "gift",
                  when: {
                    kind: "compare",
                    left: { kind: "event", path: "choiceId" },
                    operator: "equals",
                    right: { kind: "literal", value: "gift" },
                  },
                  actions: [
                    {
                      kind: "state.increment",
                      path: "favorability.lin",
                      amount: { kind: "literal", value: 80 },
                    },
                    { kind: "scene.goto", sceneId: "scene.threshold" },
                  ],
                },
                {
                  routeId: "leave",
                  when: {
                    kind: "compare",
                    left: { kind: "event", path: "choiceId" },
                    operator: "equals",
                    right: { kind: "literal", value: "leave" },
                  },
                  actions: [{ kind: "scene.goto", sceneId: "scene.threshold" }],
                },
              ],
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
        },
        {
          kind: "scene",
          sceneId: "scene.threshold",
          clock: { kind: "none" },
          renderers: [],
          eventBindings: [
            {
              bindingId: "binding:scene.threshold:enter",
              on: { type: "scene.entered" },
              routes: [
                {
                  routeId: "together",
                  when: {
                    kind: "compare",
                    left: { kind: "state", path: "favorability.lin" },
                    operator: "at-least",
                    right: { kind: "literal", value: 80 },
                  },
                  actions: [
                    { kind: "progress.unlock-ending", endingId: "ending.together" },
                    { kind: "ending.complete", endingId: "ending.together" },
                  ],
                },
                {
                  routeId: "fallback",
                  actions: [{ kind: "ending.complete", endingId: "ending.together" }],
                },
              ],
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
        },
      ],
    },
  });

  const initial = initializeExperienceRuntime(manifest);
  assert.equal(initial.values.session["favorability.lin"], 0);
  const gifted = runExperienceEventQueue(manifest, initial, [
    {
      type: "renderer.outcome",
      sourceId: "renderer:scene.gate:choice",
      qualifierId: "choice-selected",
      payload: { choiceId: "gift" },
    },
  ]);
  assert.equal(gifted.state.values.session["favorability.lin"], 80);
  assert.equal(gifted.state.status, "completed");
  assert.equal(gifted.state.completedEndingId, "ending.together");
  assert.deepEqual(gifted.state.completedEndingIds, ["ending.together"]);
});
