import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceRuntimeManifestSchema } from "@repo/shared/experience-runtime";
import {
  InteractiveFilmLoadError,
  listPublishedInteractiveFilms,
  loadPublishedInteractiveFilm,
} from "./interactive-film-api";

const JAVA_URL = "https://java.example.test/studio";
const MANIFEST_URL = "https://media.example.test/interactive-film/game-one/version-1/manifest.json";
const HASH = "a".repeat(64);

function manifestFixture() {
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "production",
    gameId: "game-one",
    buildId: "build-one",
    contentVersion: "version-1",
    completionPolicy: "finite",
    metadata: { title: { "en-US": "Game one" } },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.video"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: [],
    rendererRequirements: [
      {
        rendererId: "core.video",
        apiVersion: "1.0.0",
        configSchemaVersion: "1.0.0",
        requiredCapabilities: ["core.video"],
        outcomes: [{ outcomeType: "media-ended" }],
        commands: [],
      },
    ],
    assets: [
      {
        assetId: "theme.config",
        kind: "data",
        sourceAssetId: "theme.config.source",
        sha256: HASH,
        uri: "/experience-runtime/themes/core.film-dark.v1.json",
        mediaType: "application/json",
        format: "json",
      },
      {
        assetId: "video.entry",
        kind: "video",
        orientationPolicy: "single-master",
        audioMode: "embedded",
        variants: [
          {
            variantId: "video.entry.landscape",
            sourceAssetId: "video.entry.source",
            sha256: HASH,
            uri: "https://media.example.test/video.mp4",
            mediaType: "video/mp4",
            orientation: "landscape",
            width: 1920,
            height: 1080,
            durationMs: 12_000,
          },
        ],
      },
    ],
    theme: { themeId: "core.film-dark", apiVersion: "1.0.0", configAssetId: "theme.config" },
    telemetryDefinitions: [],
    endings: [{ endingId: "ending.complete", title: { "en-US": "Complete" }, kind: "success" }],
    graph: {
      entrySceneId: "scene.entry",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.entry",
          clock: { kind: "renderer", rendererInstanceId: "video.entry.renderer" },
          renderers: [
            {
              instanceId: "video.entry.renderer",
              rendererId: "core.video",
              layer: 0,
              config: {
                fit: "cover",
                autoplay: true,
                sequence: [
                  {
                    clipId: "clip.entry",
                    assetId: "video.entry",
                    endBehavior: { behavior: "advance" },
                  },
                ],
              },
              bindings: {},
            },
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "entry.complete",
              on: {
                type: "renderer.outcome",
                sourceId: "video.entry.renderer",
                qualifierId: "media-ended",
              },
              routes: [
                {
                  routeId: "complete",
                  actions: [{ kind: "ending.complete", endingId: "ending.complete" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

test("loads the Java catalogue envelope without weakening its contract", async () => {
  const fetcher = async (input: string | URL) => {
    assert.equal(String(input), `${JAVA_URL}/api/player/interactive-film/games`);
    return Response.json({
      code: 200,
      msg: "成功",
      data: [
        {
          gameId: "game-one",
          title: "Game one",
          currentVersion: "version-1",
          updatedAt: "2026-07-16T16:17:58+08:00",
        },
      ],
    });
  };

  const result = await listPublishedInteractiveFilms({ fetcher, javaStudioUrl: JAVA_URL });
  assert.equal(result[0]?.gameId, "game-one");
});

test("loads and identity-checks Java metadata plus its immutable CDN manifest", async () => {
  const manifest = manifestFixture();
  const fetcher = async (input: string | URL) => {
    const url = String(input);
    if (url === `${JAVA_URL}/api/player/interactive-film/games/game-one`) {
      return Response.json({
        code: 200,
        msg: "成功",
        data: {
          gameId: "game-one",
          title: "Game one",
          currentVersion: "version-1",
          manifestUrl: MANIFEST_URL,
        },
      });
    }
    assert.equal(url, MANIFEST_URL);
    return Response.json(manifest);
  };

  const result = await loadPublishedInteractiveFilm("game-one", {
    fetcher,
    javaStudioUrl: JAVA_URL,
  });
  assert.equal(result.game.currentVersion, "version-1");
  assert.equal(result.manifest.buildId, "build-one");
});

test("surfaces Java's message when the current game cannot be resolved", async () => {
  const fetcher = async () => Response.json({ code: 404, msg: "游戏不存在", data: null });

  await assert.rejects(
    loadPublishedInteractiveFilm("missing", { fetcher, javaStudioUrl: JAVA_URL }),
    (error: unknown) =>
      error instanceof InteractiveFilmLoadError &&
      error.code === "JAVA_REQUEST_FAILED" &&
      error.message === "游戏不存在"
  );
});

test("rejects Java records whose CDN payload is not Runtime Manifest v2", async () => {
  const fetcher = async (input: string | URL) =>
    String(input).includes("/games/")
      ? Response.json({
          code: 200,
          msg: "成功",
          data: {
            gameId: "game-one",
            title: "Game one",
            currentVersion: "version-1",
            manifestUrl: MANIFEST_URL,
          },
        })
      : Response.json({ test: "not-a-runtime-manifest" });

  await assert.rejects(
    loadPublishedInteractiveFilm("game-one", { fetcher, javaStudioUrl: JAVA_URL }),
    (error: unknown) =>
      error instanceof InteractiveFilmLoadError && error.code === "MANIFEST_INVALID"
  );
});
