import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExperienceRuntimeManifestSchema,
  type ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import {
  ExperiencePlayer,
  resolveLookAheadVideoMedia,
  resolveLockedScenePreview,
} from "./experience-player";
import type { ExperiencePlayerCopy } from "./experience-player-copy";
import { journeyMapTestCopy, subtitleTestCopy } from "./experience-journey-test-copy";

const HASH = "a".repeat(64);

it("uses an image-only frozen-media endpoint for the locked scene preview", () => {
  const runtime = ExperienceRuntimeManifestSchema.parse(
    runtimeFixture({ completion: "passive", rendererKind: "video" })
  );
  const asset = runtime.assets.find((item) => item.kind === "video")!;
  if (asset.kind !== "video") throw new Error("Missing video");
  const content =
    "/aurora/story-projects/project/builds/build/assets/asset/variants/original/content";
  asset.variants[0]!.uri = content;
  expect(resolveLockedScenePreview(runtime, runtime.graph.nodes[0]!, "landscape")).toEqual({
    videoUri: content,
    posterUri: content.replace("/content", "/poster"),
  });
  asset.variants[0]!.uri = "https://external.test/paid.mp4";
  expect(
    resolveLockedScenePreview(runtime, runtime.graph.nodes[0]!, "landscape").posterUri
  ).toBeUndefined();
});

const copy: ExperiencePlayerCopy = {
  journeyMap: journeyMapTestCopy,
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
    unmute: "Unmute",
    subtitles: subtitleTestCopy,
  },
  playback: {
    transport: {
      controlsLabel: "Playback controls",
      rewind10: "Back 10 seconds",
      forward10: "Forward 10 seconds",
      progressLabel: "Clip progress",
      speedLabel: "Playback speed",
      watchedOnlyHint: "You can seek only within footage you have watched.",
      interactionBlocked: "Playback controls are unavailable during an interaction.",
    },
    pause: "Pause",
    resume: "Resume",
    paused: "Paused",
    continuePlaying: "Tap to continue",
    interrupted: "This device needs a tap to keep playing.",
  },
};

function localized(english: string, chinese: string) {
  return { "en-US": english, "zh-CN": chinese };
}

function runtimeFixture(input: {
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
        })}
        coverUrl="https://media.example.com/story-cover.jpg"
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

    expect(html).toContain(">Loading</button>");
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

  it("offers a disabled Loading control until the entry clip is on an element", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({ completion: "passive", rendererKind: "video" })}
        locale="en-US"
        copy={copy}
        randomSeed="core-video-entry-start-gate-test"
      />
    );

    // No handle is registered during a server render, so Start waits — and
    // says why — instead of offering to play nothing.
    const start = /<button[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/.exec(
      html.slice(html.indexOf(copy.interactiveFilm))
    )?.[0];
    expect(start).toContain('disabled=""');
    expect(start).toContain(">Loading</button>");
    expect(html).not.toContain(">Start<");
  });

  it("holds an entry with no media until its theme is loaded", () => {
    const html = renderToStaticMarkup(
      <ExperiencePlayer
        runtime={runtimeFixture({ experienceProfile: "narrative", completion: "continue" })}
        locale="en-US"
        copy={copy}
        randomSeed="core-text-entry-start-test"
      />
    );

    expect(html).toContain(">Loading</button>");
    expect(html).toContain('disabled=""');
  });
});

describe("resolveLookAheadVideoMedia", () => {
  const video = (assetId: string, uri: string, mediaType = "video/mp4") => ({
    assetId,
    kind: "video",
    orientationPolicy: "single-master",
    variants: [
      {
        variantId: `${assetId}.landscape`,
        sourceAssetId: `${assetId}.source`,
        sha256: HASH,
        uri,
        mediaType,
        orientation: "landscape",
        width: 1920,
        height: 1080,
        durationMs: 5_000,
      },
    ],
  });
  const scene = (
    sceneId: string,
    assetIds: string[],
    extra: { access?: unknown; eventBindings?: unknown[] } = {}
  ) => ({
    kind: "scene",
    sceneId,
    clock: { kind: "none" },
    renderers: [
      {
        instanceId: `${sceneId}.video`,
        rendererId: "core.video",
        layer: 0,
        config: {
          fit: "cover",
          sequence: assetIds.map((assetId, index) => ({
            clipId: `${sceneId}.clip-${index}`,
            assetId,
            endBehavior: { behavior: "advance" },
          })),
          autoplay: true,
        },
        bindings: {},
      },
    ],
    anchors: [],
    gestures: [],
    timeline: { cues: [] },
    eventBindings: extra.eventBindings ?? [],
    ...(extra.access ? { access: extra.access } : {}),
  });
  const paid = { key: "node:locked", communityPointPrice: 20, title: { "en-US": "Locked" } };
  const goto = (sceneId: string) => ({ kind: "scene.goto", sceneId });
  const runtime = {
    ...runtimeFixture({ completion: "passive", rendererKind: "video" }),
    assets: [
      video("current.a", "/current-a.mp4"),
      video("current.still", "/current-still.png", "image/png"),
      video("current.b", "/current-b.mp4"),
      video("next.a", "/next-a.mp4"),
      video("next.b", "/next-b.mp4"),
      video("still.a", "/still-opening.png", "image/png"),
      video("paid.route", "/paid-route.mp4"),
      video("locked.node", "/locked-node.mp4"),
      video("unrelated", "/unrelated.mp4"),
    ],
    graph: {
      entrySceneId: "scene.current",
      nodes: [
        scene("scene.current", ["current.a", "current.still", "current.b", "current.a"], {
          eventBindings: [
            {
              bindingId: "current.ended",
              on: {
                type: "renderer.outcome",
                sourceId: "scene.current.video",
                qualifierId: "media-ended",
              },
              routes: [
                // A retry of the current scene is already on stage.
                { routeId: "next", actions: [goto("scene.next"), goto("scene.current")] },
                { routeId: "paid", access: paid, actions: [goto("scene.paid")] },
              ],
            },
            {
              bindingId: "current.choice",
              on: { type: "renderer.outcome", sourceId: "choice", qualifierId: "choice-selected" },
              routes: [
                { routeId: "locked", actions: [goto("scene.locked")] },
                { routeId: "still", actions: [goto("scene.still")] },
                { routeId: "again", actions: [goto("scene.next")] },
              ],
            },
          ],
        }),
        scene("scene.next", ["next.a", "next.b"]),
        scene("scene.still", ["still.a", "next.b"]),
        scene("scene.paid", ["paid.route"]),
        scene("scene.locked", ["locked.node"], { access: paid }),
        scene("scene.unrelated", ["unrelated"]),
      ],
    },
  } as unknown as ExperienceRuntimeManifest;

  it("plans the rest of the current scene, then each reachable scene's opening clip", () => {
    expect(resolveLookAheadVideoMedia(runtime, "scene.current", "landscape")).toEqual([
      { src: "/current-a.mp4", type: "video/mp4" },
      { src: "/current-b.mp4", type: "video/mp4" },
      { src: "/next-a.mp4", type: "video/mp4" },
    ]);
  });

  it("includes routes and scenes the viewer has unlocked, in route order", () => {
    expect(
      resolveLookAheadVideoMedia(runtime, "scene.current", "landscape", () => true).map(
        (media) => media.src
      )
    ).toEqual([
      "/current-a.mp4",
      "/current-b.mp4",
      "/next-a.mp4",
      "/paid-route.mp4",
      "/locked-node.mp4",
    ]);
  });

  it("plans nothing from a node that is not a scene", () => {
    expect(resolveLookAheadVideoMedia(runtime, "scene.missing", "landscape")).toEqual([]);
  });
});

it("does not render paid entry content before authorization", () => {
  const runtime = runtimeFixture({ experienceProfile: "narrative", completion: "continue" });
  const paid = {
    ...runtime,
    compatibility: {
      ...runtime.compatibility,
      requiredCapabilities: [
        ...runtime.compatibility.requiredCapabilities,
        "commerce.community-points",
      ],
    },
    graph: {
      ...runtime.graph,
      nodes: runtime.graph.nodes.map((node, index) =>
        index === 0
          ? {
              ...node,
              access: { key: "node:entry", communityPointPrice: 20, title: { "en-US": "Entry" } },
            }
          : node
      ),
    },
  };
  const html = renderToStaticMarkup(
    <ExperiencePlayer
      runtime={paid}
      locale="en-US"
      copy={copy}
      access={{
        canAccess: () => false,
        requestAccess: async () => false,
        formatPrice: (amount) => `${amount} points`,
      }}
    />
  );
  expect(html).not.toContain('data-experience-renderer="core.text"');
  expect(html).not.toContain(copy.invalidManifest);
});
