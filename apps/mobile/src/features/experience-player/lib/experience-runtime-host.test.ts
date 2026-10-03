import { expect, it, vi } from "vitest";
import { parseExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { EXPERIENCE_ENGINE_API_VERSION, EXPERIENCE_API_VERSION } from "@repo/experience-engine";
import { createExperienceRuntime } from "./experience-runtime-host";
const HASH = "a".repeat(64);
const localized = (value: string) => ({ "en-US": value });
function manifestFixture() {
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

it("starts an ordinary text film with the actual native host", () => {
  const controller = createExperienceRuntime(manifestFixture(), {});
  expect(controller.start().state.currentSceneId).toBe("scene.text");
});
it.each([true, false])(
  "rejects an unimplemented world renderer before playback (declared capability: %s)",
  (declared) => {
    const manifest = manifestFixture();
    manifest.compatibility.requiredCapabilities = declared ? ["core.world-model"] : [];
    manifest.rendererRequirements = [
      {
        rendererId: "core.world-model",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.world-model"],
        outcomes: [{ outcomeType: "world-completed" }],
        commands: [],
      },
    ];
    expect(() => createExperienceRuntime(manifest, {})).toThrow(/core.world-model/);
  }
);

it("queues completion behind session creation, retries saving, and starts a fresh replay", async () => {
  let start!: (value: { sessionId: string }) => void;
  const reporter = {
    onStart: vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          start = resolve;
        })
      )
      .mockResolvedValue({ sessionId: "second" }),
    onProgress: vi.fn().mockResolvedValue(undefined),
    onComplete: vi
      .fn()
      .mockRejectedValueOnce(new Error("Save offline"))
      .mockResolvedValue(undefined),
  };
  const controller = createExperienceRuntime(manifestFixture(), { reporter });
  controller.start();
  controller.emitRendererOutcome({
    instanceId: "text.primary",
    outcomeType: "text-completed",
    payload: {},
  });
  expect(reporter.onComplete).not.toHaveBeenCalled();
  start({ sessionId: "first" });
  await vi.waitFor(() => expect(controller.getPlaySessionReportError()).toBe("Save offline"));
  expect(controller.getCompletedPlaySessionId()).toBeNull();
  controller.retryPlaySessionReport();
  await vi.waitFor(() => expect(controller.getCompletedPlaySessionId()).toBe("first"));
  expect(controller.getPlaySessionReportError()).toBeNull();
  expect(reporter.onComplete).toHaveBeenLastCalledWith(
    "first",
    expect.objectContaining({ endingId: "ending.done" })
  );
  const replay = createExperienceRuntime(manifestFixture(), { reporter });
  replay.start();
  replay.emitRendererOutcome({
    instanceId: "text.primary",
    outcomeType: "text-completed",
    payload: {},
  });
  await vi.waitFor(() => expect(replay.getCompletedPlaySessionId()).toBe("second"));
  expect(reporter.onStart).toHaveBeenCalledTimes(2);
});
