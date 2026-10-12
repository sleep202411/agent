import { parseExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { EXPERIENCE_ENGINE_API_VERSION, EXPERIENCE_API_VERSION } from "@repo/experience-engine";
const HASH = "a".repeat(64);
const localized = (value: string) => ({ "en-US": value });
export function worldManifestFixture() {
  return parseExperienceRuntimeManifest({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "core.world-model.test",
    buildId: "core.world-model.build.1",
    contentVersion: "1.0.0",
    completionPolicy: "finite",
    metadata: {
      title: localized("A text experience"),
    },
    compatibility: {
      engineApiVersion: EXPERIENCE_ENGINE_API_VERSION,
      experienceApiVersion: EXPERIENCE_API_VERSION,
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.world-model"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    rendererRequirements: [
      {
        rendererId: "core.world-model",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.world-model"],
        outcomes: [{ outcomeType: "world-completed" }],
        commands: [{ commandType: "end" }],
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
              rendererId: "core.world-model",
              layer: 0,
              config: {
                projectId: "21111111-1111-4111-8111-111111111111",
                worldId: "31111111-1111-4111-8111-111111111111",
                maxExperienceSeconds: 90,
                autoplay: true,
              },
            },
          ],
          eventBindings: [
            {
              bindingId: "text.complete",
              on: {
                type: "renderer.outcome",
                sourceId: "text.primary",
                qualifierId: "world-completed",
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
