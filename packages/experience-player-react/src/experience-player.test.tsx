import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import { ExperiencePlayer, resolveNextSceneVideoUris } from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";

const HASH = "a".repeat(64);

const copy: ExperiencePlayerCopy = {
  invalidManifest: "Invalid manifest",
  manifestRoot: "Manifest",
  interactiveFilm: "Interactive film",
  starting: "Starting",
  start: "Start",
  endingEyebrow: "Ending",
  unknownEnding: (endingId) => endingId,
  playAgain: "Play again",
  runtimeError: "Runtime error",
  restart: "Restart",
  mediaError: (assetId) => assetId,
  videoLabel: (rendererInstanceId) => rendererInstanceId,
  noVisibleChoices: "No visible choices",
  continue: "继续",
  emptySequence: "No footage yet",
  loadingMedia: "Loading",
  regionLabel: "Experience player",
  video: {
    play: "Play",
    pause: "Pause",
    mute: "Mute",
    unmute: "Unmute",
    volume: "Volume",
    enterFullscreen: "Enter fullscreen",
    exitFullscreen: "Exit fullscreen",
    seekForward: "Seek forward",
    seekBackward: "Seek backward",
  },
};

function localized(english: string, chinese: string) {
  return { "en-US": english, "zh-CN": chinese };
}

function runtimeFixture(input: {
  coverUrl?: string;
  experienceProfile?: "cinematic" | "narrative";
  completion: "continue" | "passive";
  rendererKind?: "text" | "video" | "world";
  overlayKind?: "choice";
  videoFit?: "cover" | "contain" | "native";
  /**
   * Reproduces a manifest that was already published to the CDN, back when
   * Build still emitted the retired `audioMode` key. Those artifacts are
   * immutable, so the current player must keep parsing them.
   */
  retiredAudioMode?: "none" | "embedded";
  requiredHostCapabilities?: string[];
}) {
  const rendererKind = input.rendererKind ?? "text";
  const videoFit = input.videoFit ?? "cover";
  const isVideo = rendererKind === "video";
  const isWorld = rendererKind === "world";
  const overlayRendererId = input.overlayKind ? `core.${input.overlayKind}` : null;
  return {
    manifestType: "fizzdragon.experience",
    schemaVersion: 2,
    channel: "preview",
    gameId: "core.text.player.test",
    buildId: `core.${rendererKind}.player.${input.completion}`,
    contentVersion: "1.0.0",
    completionPolicy: "finite",
    metadata: {
      title: localized("A text experience", "文字体验"),
      ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
      ...(input.experienceProfile ? { experienceProfile: input.experienceProfile } : {}),
    },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: [
        isVideo ? "core.video" : isWorld ? "core.world-model" : "core.text",
        ...(overlayRendererId ? [overlayRendererId] : []),
        ...(input.requiredHostCapabilities ?? []),
      ],
    },
    localization: {
      defaultLocale: "en-US",
      locales: ["en-US", "zh-CN"],
    },
    stateDefinitions: [],
    inputActions: [],
    rendererRequirements: [
      isVideo
        ? {
            rendererId: "core.video",
            apiVersion: "1.0.0",
            configSchemaVersion: "1.0.0",
            requiredCapabilities: ["core.video"],
            outcomes: [{ outcomeType: "media-ended" }],
            commands: [],
          }
        : isWorld
          ? {
              rendererId: "core.world-model",
              apiVersion: "1.0.0",
              configSchemaVersion: "1.0.0",
              requiredCapabilities: ["core.world-model"],
              outcomes: [{ outcomeType: "world-completed" }],
              commands: [{ commandType: "end" }],
            }
          : {
              rendererId: "core.text",
              apiVersion: "1.0.0",
              configSchemaVersion: "1.0.0",
              requiredCapabilities: ["core.text"],
              outcomes: [{ outcomeType: "text-completed" }],
              commands: [],
            },
      ...(input.overlayKind === "choice"
        ? [
            {
              rendererId: "core.choice",
              apiVersion: "1.0.0",
              configSchemaVersion: "1.0.0",
              requiredCapabilities: ["core.choice"],
              outcomes: [{ outcomeType: "choice-selected" }],
              commands: [{ commandType: "open" }],
            },
          ]
        : []),
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
      ...(isVideo
        ? [
            {
              assetId: "video.primary",
              kind: "video",
              orientationPolicy: "single-master",
              variants: [
                {
                  variantId: "video.primary.landscape",
                  sourceAssetId: "video.primary.source",
                  sha256: HASH,
                  uri: "/video.mp4",
                  mediaType: "video/mp4",
                  orientation: "landscape",
                  width: 1920,
                  height: 1080,
                  durationMs: 5_000,
                },
              ],
              ...(input.retiredAudioMode ? { audioMode: input.retiredAudioMode } : {}),
            },
          ]
        : []),
    ],
    theme: { themeId: "theme.test", apiVersion: "1.0.0", configAssetId: "theme.config" },
    telemetryDefinitions: [],
    endings: [
      {
        endingId: "ending.done",
        title: localized("Done", "完成"),
        kind: "success",
      },
    ],
    graph: {
      entrySceneId: "scene.text",
      nodes: [
        {
          kind: "scene",
          sceneId: "scene.text",
          clock: { kind: "none" },
          renderers: [
            isVideo
              ? {
                  instanceId: "video.primary",
                  rendererId: "core.video",
                  layer: 0,
                  config: {
                    fit: videoFit,
                    sequence: [
                      {
                        clipId: "clip.primary",
                        assetId: "video.primary",
                        endBehavior: { behavior: "advance" },
                      },
                    ],
                    autoplay: true,
                  },
                  bindings: {},
                }
              : isWorld
                ? {
                    instanceId: "world.primary",
                    rendererId: "core.world-model",
                    layer: 0,
                    config: {
                      projectId: "0197f4a2-0800-7000-8000-000000000001",
                      worldId: "0197f4a2-0800-7000-8000-000000000002",
                      entryInstruction: "Continue through the gate.",
                      maxExperienceSeconds: 90,
                      autoplay: true,
                    },
                    bindings: {},
                  }
                : {
                    instanceId: "text.primary",
                    rendererId: "core.text",
                    layer: 0,
                    config: {
                      title: localized("Chapter one", "第一章"),
                      body: localized(
                        "The story begins.\n\nKeep reading.",
                        "故事开始。\n\n继续阅读。"
                      ),
                      completion: input.completion,
                    },
                    bindings: {},
                  },
            ...(input.overlayKind === "choice"
              ? [
                  {
                    instanceId: "choice.primary",
                    rendererId: "core.choice",
                    layer: 100,
                    config: {
                      decisionId: "decision.primary",
                      prompt: localized("Choose before start", "请在开始前选择"),
                      choices: [
                        {
                          choiceId: "choice.first",
                          label: localized("First", "第一项"),
                        },
                        {
                          choiceId: "choice.second",
                          label: localized("Second", "第二项"),
                        },
                      ],
                      initiallyOpen: true,
                    },
                    bindings: {},
                  },
                ]
              : []),
          ],
          anchors: [],
          gestures: [],
          timeline: { cues: [] },
          eventBindings: [
            {
              bindingId: "text.complete",
              on: {
                type: "renderer.outcome",
                sourceId: isVideo ? "video.primary" : isWorld ? "world.primary" : "text.primary",
                qualifierId: isVideo
                  ? "media-ended"
                  : isWorld
                    ? "world-completed"
                    : "text-completed",
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
  };
}

describe("ExperiencePlayer core.text", () => {
  it("renders a direct catalogue cover without a runtime image asset", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({
          completion: "passive",
          coverUrl: "https://media.example.com/story-cover.jpg",
        })}
        locale="en-US"
        copy={copy}
        randomSeed="direct-cover-test"
      />
    );

    expect(html).toContain('src="https://media.example.com/story-cover.jpg"');
  });

  it("renders localized scrollable narrative text with the existing continue copy", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({ experienceProfile: "narrative", completion: "continue" })}
        locale="zh-CN"
        copy={copy}
        randomSeed="core-text-player-test"
      />
    );

    expect(html).toContain('data-experience-profile="narrative"');
    expect(html).toContain('data-experience-stage-profile="narrative"');
    expect(html).toContain('data-experience-renderer="core.text"');
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("第一章");
    expect(html).toContain("故事开始。");
    expect(html).toContain(">继续<");
  });

  it("uses a narrative stage for text inside a legacy cinematic project", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({ completion: "passive" })}
        locale="zh-CN"
        copy={copy}
        randomSeed="core-text-player-legacy-test"
      />
    );

    expect(html).toContain('data-experience-profile="cinematic"');
    expect(html).toContain('data-experience-stage-profile="narrative"');
    expect(html).toContain("第一章");
    expect(html).not.toContain(">继续<");
  });

  it.each(["cinematic", "narrative"] as const)(
    "keeps video scenes in the project's %s stage profile",
    (experienceProfile) => {
      const html = renderToStaticMarkup(
        <ExperiencePlayer
          runtime={runtimeFixture({
            experienceProfile,
            completion: "passive",
            rendererKind: "video",
          })}
          locale="zh-CN"
          copy={copy}
          randomSeed={`core-video-player-${experienceProfile}-test`}
        />
      );

      expect(html).toContain(`data-experience-profile="${experienceProfile}"`);
      expect(html).toContain(`data-experience-stage-profile="${experienceProfile}"`);
      expect(html).toContain("/video.mp4");
    }
  );

  it("renders a native-profile video inline at its intrinsic aspect ratio", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({
          experienceProfile: "narrative",
          completion: "passive",
          rendererKind: "video",
          videoFit: "native",
        })}
        locale="zh-CN"
        copy={copy}
        randomSeed="core-video-native-test"
      />
    );

    // The narrative stage stays responsive and the video is inline, sized to
    // its native aspect ratio rather than covering a fixed frame.
    expect(html).toContain('data-experience-profile="narrative"');
    expect(html).toContain('data-experience-stage-profile="narrative"');
    expect(html).toContain('data-experience-video-fit="native"');
    expect(html).toContain("aspect-ratio:1920 / 1080");
    expect(html).toContain("/video.mp4");
  });

  it.each(["none", "embedded"] as const)(
    'still plays a published manifest that carries the retired audioMode "%s"',
    (retiredAudioMode) => {
      const html = renderToStaticMarkup(
        <ExperiencePlayer
          runtime={runtimeFixture({
            completion: "passive",
            rendererKind: "video",
            retiredAudioMode,
          })}
          locale="en-US"
          copy={copy}
          randomSeed={`core-video-legacy-${retiredAudioMode}-test`}
        />
      );

      // The manifest parses (no invalid-manifest alert) and the clip is staged.
      expect(html).not.toContain(copy.invalidManifest);
      expect(html).toContain("/video.mp4");
      // Nothing pre-emptively mutes the clip, so the unmute affordance — which
      // appears only after a browser actually refuses audible playback — is
      // absent no matter what the retired flag says.
      expect(html).not.toContain(copy.video.unmute);
    }
  );

  it("accepts spatial tap and swipe capabilities implemented by the React host", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({
          completion: "passive",
          rendererKind: "video",
          requiredHostCapabilities: ["input.tap", "input.swipe", "renderer.content-transform"],
        })}
        locale="zh-CN"
        copy={copy}
        randomSeed="spatial-tap-host-capabilities-test"
      />
    );

    expect(html).not.toContain(copy.invalidManifest);
    expect(html).toContain("/video.mp4");
  });

  it("keeps an initially-open text choice behind the start boundary", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({
          experienceProfile: "narrative",
          completion: "passive",
          overlayKind: "choice",
        })}
        locale="en-US"
        copy={copy}
        randomSeed="core-text-choice-start-gate-test"
      />
    );

    expect(html).toContain(">Start<");
    expect(html).not.toContain("Choose before start");
  });

  it("delegates a world scene to the host without exposing provider configuration", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({ completion: "passive", rendererKind: "world" })}
        locale="en-US"
        copy={copy}
        randomSeed="core-world-model-host-test"
        renderWorldModel={({ config, active }) => (
          <div data-testid="world-host" data-active={active}>
            {config.worldId}
          </div>
        )}
      />
    );

    expect(html).not.toContain(copy.invalidManifest);
    expect(html).toContain('data-experience-renderer="core.world-model"');
    expect(html).toContain('data-testid="world-host"');
    expect(html).toContain("0197f4a2-0800-7000-8000-000000000002");
    expect(html).not.toContain("fal:happy-oyster");
  });

  it("preloads only the video branches directly reachable from the current scene", () => {
    const base = runtimeFixture({ completion: "passive", rendererKind: "video" });
    const currentScene = base.graph.nodes[0];
    const runtime = {
      ...base,
      assets: [
        ...base.assets,
        {
          assetId: "video.next",
          kind: "video",
          orientationPolicy: "single-master",
          variants: [
            {
              variantId: "video.next.landscape",
              sourceAssetId: "video.next.source",
              sha256: HASH,
              uri: "/next.mp4",
              mediaType: "video/mp4",
              orientation: "landscape",
              width: 1920,
              height: 1080,
              durationMs: 5_000,
            },
          ],
        },
        {
          assetId: "video.unrelated",
          kind: "video",
          orientationPolicy: "single-master",
          variants: [
            {
              variantId: "video.unrelated.landscape",
              sourceAssetId: "video.unrelated.source",
              sha256: HASH,
              uri: "/unrelated.mp4",
              mediaType: "video/mp4",
              orientation: "landscape",
              width: 1920,
              height: 1080,
              durationMs: 5_000,
            },
          ],
        },
      ],
      graph: {
        ...base.graph,
        nodes: [
          {
            ...currentScene,
            eventBindings: [
              {
                bindingId: "scene.next",
                on: {
                  type: "renderer.outcome",
                  sourceId: "video.primary",
                  qualifierId: "media-ended",
                },
                routes: [
                  {
                    routeId: "next",
                    actions: [
                      { kind: "scene.goto", sceneId: "scene.next" },
                      // A retry of the current clip is already warm and must not
                      // create a second detached media element.
                      { kind: "scene.goto", sceneId: "scene.text" },
                    ],
                  },
                ],
              },
            ],
          },
          {
            ...currentScene,
            sceneId: "scene.next",
            renderers: [
              {
                instanceId: "video.next",
                rendererId: "core.video",
                layer: 0,
                config: {
                  fit: "cover",
                  sequence: [
                    {
                      clipId: "clip.next",
                      assetId: "video.next",
                      endBehavior: { behavior: "advance" },
                    },
                  ],
                  autoplay: true,
                },
                bindings: {},
              },
            ],
            eventBindings: [],
          },
          {
            ...currentScene,
            sceneId: "scene.unrelated",
            renderers: [
              {
                instanceId: "video.unrelated",
                rendererId: "core.video",
                layer: 0,
                config: {
                  fit: "cover",
                  sequence: [
                    {
                      clipId: "clip.unrelated",
                      assetId: "video.unrelated",
                      endBehavior: { behavior: "advance" },
                    },
                  ],
                  autoplay: true,
                },
                bindings: {},
              },
            ],
            eventBindings: [],
          },
        ],
      },
    } as unknown as ExperienceRuntimeManifest;

    expect(resolveNextSceneVideoUris(runtime, "scene.text", "landscape")).toEqual(["/next.mp4"]);
  });
});
