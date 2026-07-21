import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperiencePlayer } from "./experience-player";
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
  checkpointPrompt: "Continue?",
  checkpointDescription: "Confirm to continue.",
  continue: "继续",
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
  experienceProfile?: "cinematic" | "narrative";
  completion: "continue" | "passive";
  rendererKind?: "text" | "video";
  overlayKind?: "choice" | "checkpoint";
  videoFit?: "cover" | "contain" | "native";
  /**
   * Reproduces a manifest that was already published to the CDN, back when
   * Build still emitted the retired `audioMode` key. Those artifacts are
   * immutable, so the current player must keep parsing them.
   */
  retiredAudioMode?: "none" | "embedded";
}) {
  const rendererKind = input.rendererKind ?? "text";
  const videoFit = input.videoFit ?? "cover";
  const isVideo = rendererKind === "video";
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
      ...(input.experienceProfile ? { experienceProfile: input.experienceProfile } : {}),
    },
    compatibility: {
      engineApiVersion: "2.0.0",
      experienceApiVersion: "1.0.0",
      semanticRulesVersion: 1,
      requiredCapabilities: [
        isVideo ? "core.video" : "core.text",
        ...(overlayRendererId ? [overlayRendererId] : []),
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
        : input.overlayKind === "checkpoint"
          ? [
              {
                rendererId: "core.checkpoint",
                apiVersion: "1.0.0",
                configSchemaVersion: "1.0.0",
                requiredCapabilities: ["core.checkpoint"],
                outcomes: [{ outcomeType: "checkpoint.continue" }],
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
              : input.overlayKind === "checkpoint"
                ? [
                    {
                      instanceId: "checkpoint.primary",
                      rendererId: "core.checkpoint",
                      layer: 100,
                      config: {
                        actionIds: ["checkpoint.continue"],
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
                sourceId: isVideo ? "video.primary" : "text.primary",
                qualifierId: isVideo ? "media-ended" : "text-completed",
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

  it.each(["choice", "checkpoint"] as const)(
    "keeps an initially-open text %s behind the start boundary",
    (overlayKind) => {
      const html = renderToStaticMarkup(
        <ExperiencePlayer
          runtime={runtimeFixture({
            experienceProfile: "narrative",
            completion: "passive",
            overlayKind,
          })}
          locale="en-US"
          copy={copy}
          randomSeed={`core-text-${overlayKind}-start-gate-test`}
        />
      );

      expect(html).toContain(">Start<");
      expect(html).not.toContain("Choose before start");
      expect(html).not.toContain(copy.checkpointPrompt);
    }
  );
});
