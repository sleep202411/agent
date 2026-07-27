import assert from "node:assert/strict";
import test from "node:test";
import { parseExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import {
  EXPERIENCE_API_VERSION,
  EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER,
  EXPERIENCE_ENGINE_API_VERSION,
  ExperienceRendererRegistry,
  ExperienceRuntimeController,
} from "../dist/index.js";

const HASH = "a".repeat(64);

function localized(value) {
  return { "en-US": value };
}

function manifestFixture(experienceProfile) {
  return parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "core.text.test",
    buildId: "core.text.build.1",
    contentVersion: "1.0.0",
    completionPolicy: "finite",
    metadata: {
      title: localized("A text experience"),
      ...(experienceProfile ? { experienceProfile } : {}),
    },
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.text"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    rendererRequirements: [
      {
        rendererId: "core.text",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.text"],
        outcomes: [{ outcomeType: "text-completed" }],
        commands: [],
      },
    ],
    assets: [
      {
        assetId: "theme.config",
        sourceAssetId: "theme.config.source",
        kind: "data",
        sha256: HASH,
        uri: "/theme.json",
        mediaType: "application/json",
        format: "json",
      },
    ],
    theme: { themeId: "theme.test", apiVersion: "1.0.0", configAssetId: "theme.config" },
    endings: [
      {
        endingId: "ending.done",
        title: localized("Done"),
        kind: "success",
      },
    ],
    graph: {
      entrySceneId: "scene.text",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.text",
          renderers: [
            {
              instanceId: "text.primary",
              rendererId: "core.text",
              layer: 0,
              config: {
                title: localized("Chapter one"),
                body: localized("The story begins."),
                completion: "continue",
              },
            },
          ],
          eventBindings: [
            {
              bindingId: "text.complete",
              on: {
                type: "renderer.outcome",
                sourceId: "text.primary",
                qualifierId: "text-completed",
              },
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

function controllerFor(manifest) {
  const rendererRegistry = new ExperienceRendererRegistry();
  rendererRegistry.register(EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER);
  return new ExperienceRuntimeController(manifest, {
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      capabilities: new Set(["core.text"]),
    },
    rendererRegistry,
  });
}

test("validates core.text config strictly", () => {
  assert.doesNotThrow(() =>
    EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.assertConfig({
      title: localized("Chapter one"),
      body: localized("The story begins."),
      completion: "continue",
    })
  );
  assert.throws(
    () =>
      EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.assertConfig({
        body: localized("The story begins."),
        completion: "continue",
        unexpected: true,
      }),
    { code: "RENDERER_CONFIG_INVALID" }
  );
  assert.throws(() => EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.assertConfig({ text: "Legacy text" }), {
    code: "RENDERER_CONFIG_INVALID",
  });
  assert.throws(
    () =>
      EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.assertConfig({
        body: {},
        completion: "passive",
      }),
    { code: "RENDERER_CONFIG_INVALID" }
  );
});

test("accepts only the declared empty text-completed outcome", () => {
  assert.equal(EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.supportsOutcome("text-completed"), true);
  assert.equal(EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.supportsOutcome("media-ended"), false);
  assert.doesNotThrow(() =>
    EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.assertOutcome("text-completed", {})
  );
  assert.throws(
    () =>
      EXPERIENCE_CORE_TEXT_RENDERER_ADAPTER.assertOutcome("text-completed", {
        unexpected: true,
      }),
    { code: "RENDERER_OUTCOME_INVALID" }
  );
});

test("routes text-completed through the runtime controller", () => {
  const controller = controllerFor(manifestFixture("narrative"));
  assert.throws(
    () =>
      controller.emitRendererOutcome({
        instanceId: "text.primary",
        outcomeType: "text-completed",
        payload: {},
      }),
    { code: "RUNTIME_NOT_STARTED" }
  );
  assert.equal(controller.state().status, "active");
  controller.start();
  const result = controller.emitRendererOutcome({
    instanceId: "text.primary",
    outcomeType: "text-completed",
    payload: {},
  });
  assert.equal(result.state.status, "completed");
  assert.equal(result.state.completedEndingId, "ending.done");
});

test("keeps the experience profile optional while rejecting unknown profiles", () => {
  assert.equal(manifestFixture("narrative").metadata.experienceProfile, "narrative");
  assert.equal(manifestFixture().metadata.experienceProfile, undefined);
  assert.throws(() => manifestFixture("immersive"));
});
