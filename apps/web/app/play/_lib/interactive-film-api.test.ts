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
const TEXT_MANIFEST_URL =
  "https://media.example.test/interactive-film/text-game/version-1/manifest.json";
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
        // Deliberate legacy-tolerance fixture. `audioMode` is retired: Build
        // stopped emitting it and nothing reads it. Every manifest already
        // published to the CDN still carries it, and those artifacts are
        // immutable, so the schema must keep ACCEPTING the key or every
        // existing film stops parsing and stops playing. This fixture is what
        // proves it — do not "modernize" it away.
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

function textManifestFixture() {
  return ExperienceRuntimeManifestSchema.parse({
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "production",
    gameId: "text-game",
    buildId: "build-text-one",
    contentVersion: "version-1",
    completionPolicy: "finite",
    metadata: {
      title: { "en-US": "Text game" },
      experienceProfile: "narrative",
    },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: ["core.text"],
    },
    localization: { defaultLocale: "en-US", locales: ["en-US"] },
    stateDefinitions: [],
    inputActions: [],
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
        kind: "data",
        sourceAssetId: "theme.config.source",
        sha256: HASH,
        uri: "/experience-runtime/themes/core.film-dark.v1.json",
        mediaType: "application/json",
        format: "json",
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
          clock: { kind: "none" },
          renderers: [
            {
              instanceId: "text.entry.renderer",
              rendererId: "core.text",
              layer: 0,
              config: {
                title: { "en-US": "The first page" },
                body: { "en-US": "A text-first story can start without any video assets." },
                completion: "continue",
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
                sourceId: "text.entry.renderer",
                qualifierId: "text-completed",
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

test("loads a text-first release without requiring a video asset", async () => {
  const manifest = textManifestFixture();
  const fetcher = async (input: string | URL) => {
    const url = String(input);
    if (url === `${JAVA_URL}/api/player/interactive-film/games/text-game`) {
      return Response.json({
        code: 200,
        msg: "success",
        data: {
          gameId: "text-game",
          title: "Text game",
          currentVersion: "version-1",
          manifestUrl: TEXT_MANIFEST_URL,
        },
      });
    }
    assert.equal(url, TEXT_MANIFEST_URL);
    return Response.json(manifest);
  };

  const result = await loadPublishedInteractiveFilm("text-game", {
    fetcher,
    javaStudioUrl: JAVA_URL,
  });

  assert.equal(result.manifest.metadata.experienceProfile, "narrative");
  assert.equal(
    result.manifest.assets.some((asset) => asset.kind === "video"),
    false
  );
  const entry = result.manifest.graph.nodes[0];
  assert.equal(entry?.kind, "scene");
  assert.equal(entry?.kind === "scene" ? entry.renderers[0]?.rendererId : null, "core.text");
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

const GAME_MANIFEST_URL = "https://media.example.test/interactive-film/serial/toc.json";
const PROLOGUE_URL = "https://r2.fizzdragon.com/story-chapters/serial/prologue/manifest.json";
const CHAPTER_ONE_URL = "https://r2.fizzdragon.com/story-chapters/serial/chapter-one/manifest.json";

function chapterManifestFixture(contentVersion: string, title: string) {
  return ExperienceRuntimeManifestSchema.parse({
    ...manifestFixture(),
    gameId: "serial",
    buildId: contentVersion,
    contentVersion,
    metadata: { title: { "en-US": title } },
  });
}

function gameManifestFixture() {
  return {
    manifestType: "fizzdragon.experience-game",
    schemaVersion: 1,
    gameId: "serial",
    contentVersion: "toc-1",
    defaultLocale: "en-US",
    chapters: [
      {
        chapterId: "chapter-prologue",
        rank: 0,
        title: { "en-US": "Prologue" },
        manifestUrl: PROLOGUE_URL,
        contentVersion: "prologue-build",
        manifestHash: HASH,
      },
      {
        chapterId: "chapter-one",
        rank: 1,
        title: { "en-US": "Chapter one" },
        manifestUrl: CHAPTER_ONE_URL,
        contentVersion: "chapter-one-build",
        manifestHash: HASH,
      },
    ],
  };
}

function serialFetcher(overrides: Record<string, unknown> = {}) {
  const documents: Record<string, unknown> = {
    [GAME_MANIFEST_URL]: gameManifestFixture(),
    [PROLOGUE_URL]: chapterManifestFixture("prologue-build", "Prologue"),
    [CHAPTER_ONE_URL]: chapterManifestFixture("chapter-one-build", "Chapter one"),
    ...overrides,
  };
  return async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/games/")) {
      return Response.json({
        code: 200,
        msg: "成功",
        data: {
          gameId: "serial",
          title: "Serial work",
          currentVersion: "toc-1",
          manifestUrl: GAME_MANIFEST_URL,
        },
      });
    }
    assert.ok(url in documents, `unexpected fetch ${url}`);
    return Response.json(documents[url]);
  };
}

test("opens a serial release on its first chapter and lists every chapter", async () => {
  const result = await loadPublishedInteractiveFilm("serial", {
    fetcher: serialFetcher(),
    javaStudioUrl: JAVA_URL,
  });

  assert.equal(result.activeChapterId, "chapter-prologue");
  assert.equal(result.manifest.contentVersion, "prologue-build");
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.manifestUrl),
    [PROLOGUE_URL, CHAPTER_ONE_URL]
  );
});

test("plays the requested chapter from its own manifest URL", async () => {
  const result = await loadPublishedInteractiveFilm("serial", {
    fetcher: serialFetcher(),
    javaStudioUrl: JAVA_URL,
    chapterId: "chapter-one",
  });

  assert.equal(result.activeChapterId, "chapter-one");
  assert.equal(result.manifest.contentVersion, "chapter-one-build");
  assert.equal(result.manifest.metadata.title["en-US"], "Chapter one");
});

test("refuses a chapter object that serves a different content version", async () => {
  const fetcher = serialFetcher({
    [PROLOGUE_URL]: chapterManifestFixture("swapped-build", "Swapped"),
  });

  await assert.rejects(
    loadPublishedInteractiveFilm("serial", { fetcher, javaStudioUrl: JAVA_URL }),
    (error: unknown) =>
      error instanceof InteractiveFilmLoadError && error.code === "MANIFEST_IDENTITY_MISMATCH"
  );
});

test("reports an unknown chapter instead of silently opening another one", async () => {
  await assert.rejects(
    loadPublishedInteractiveFilm("serial", {
      fetcher: serialFetcher(),
      javaStudioUrl: JAVA_URL,
      chapterId: "chapter-nine",
    }),
    (error: unknown) =>
      error instanceof InteractiveFilmLoadError && error.code === "CHAPTER_NOT_FOUND"
  );
});
