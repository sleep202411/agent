import assert from "node:assert/strict";
import test from "node:test";
import { parseExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import {
  ExperienceRuntimeController,
  ExperienceRendererRegistry,
  EXPERIENCE_CORE_RENDERER_ADAPTERS,
  ExperienceAccessRequiredError,
} from "../dist/index.js";
const access = (key) => ({ key, communityPointPrice: 20, title: { "en-US": key } });
function fixture({
  entryPaid = false,
  routePaid = false,
  targetPaid = false,
  router = false,
} = {}) {
  return parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "production",
    gameId: "game",
    buildId: "build",
    contentVersion: "build",
    completionPolicy: "open-ended",
    metadata: { title: { "en-US": "Film" } },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.text", "commerce.community-points"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    assets: [
      {
        assetId: "theme",
        kind: "data",
        sourceAssetId: "theme-source",
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
    stateDefinitions: [{ key: "count", valueType: "number", scope: "session", initialValue: 0 }],
    graph: {
      entrySceneId: "start",
      nodes: [
        {
          kind: "scene",
          sceneId: "start",
          ...(entryPaid ? { access: access("node:start") } : {}),
          eventBindings: [
            {
              bindingId: "choose",
              on: { type: router ? "scene.entered" : "choice.selected" },
              routes: [
                {
                  routeId: "go",
                  ...(routePaid ? { access: access("node:target") } : {}),
                  actions: [
                    {
                      kind: "state.increment",
                      path: "count",
                      amount: { kind: "literal", value: 1 },
                    },
                    { kind: "scene.goto", sceneId: router ? "router" : "target" },
                  ],
                },
              ],
            },
          ],
        },
        ...(router
          ? [
              {
                kind: "router",
                sceneId: "router",
                eventBindings: [
                  {
                    bindingId: "route",
                    on: { type: "scene.entered" },
                    routes: [
                      { routeId: "forward", actions: [{ kind: "scene.goto", sceneId: "target" }] },
                    ],
                  },
                ],
              },
            ]
          : []),
        {
          kind: "scene",
          sceneId: "target",
          ...(targetPaid ? { access: access("node:target") } : {}),
          eventBindings: [],
        },
      ],
    },
  });
}
function controller(manifest, owned = new Set()) {
  const registry = new ExperienceRendererRegistry();
  EXPERIENCE_CORE_RENDERER_ADAPTERS.forEach((adapter) => registry.register(adapter));
  return new ExperienceRuntimeController(manifest, {
    rendererRegistry: registry,
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      capabilities: new Set(["core.text", "commerce.community-points"]),
    },
    canAccess: (requirement) => owned.has(requirement.key),
  });
}
test("paid entry cannot start; a successful unlock retries start exactly once", () => {
  const owned = new Set();
  const runtime = controller(fixture({ entryPaid: true }), owned);
  const before = runtime.state();
  assert.throws(() => runtime.start(), ExperienceAccessRequiredError);
  assert.deepEqual(runtime.state(), before);
  owned.add("node:start");
  runtime.start();
  assert.throws(() => runtime.start(), /already started/);
});
test("unpaid choice and unpaid destination leave all state untouched", () => {
  for (const options of [
    { routePaid: true },
    { targetPaid: true },
    { routePaid: true, targetPaid: true },
  ]) {
    const owned = new Set();
    const runtime = controller(fixture(options), owned);
    runtime.start();
    const before = runtime.state();
    assert.throws(
      () => runtime.dispatch([{ type: "choice.selected" }]),
      ExperienceAccessRequiredError
    );
    assert.deepEqual(runtime.state(), before);
    owned.add("node:target");
    runtime.dispatch([{ type: "choice.selected" }]);
    assert.equal(runtime.state().currentSceneId, "target");
    assert.equal(runtime.state().values.session.count, 1);
  }
});
test("entry routers cannot bypass a downstream paid node or commit earlier effects", () => {
  const owned = new Set();
  const runtime = controller(fixture({ router: true, targetPaid: true }), owned);
  const before = runtime.state();
  assert.throws(() => runtime.start(), ExperienceAccessRequiredError);
  assert.deepEqual(runtime.state(), before);
  owned.add("node:target");
  runtime.start();
  assert.equal(runtime.state().currentSceneId, "target");
  assert.equal(runtime.state().values.session.count, 1);
});
test("published chapter manifests labelled preview still require access", () => {
  const manifest = fixture({ entryPaid: true });
  manifest.channel = "preview";
  assert.throws(() => controller(manifest).start(), ExperienceAccessRequiredError);
});
