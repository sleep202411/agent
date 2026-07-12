import assert from "node:assert/strict";
import test from "node:test";
import { parseInteractiveFilmRelease } from "./release-manifest";

function fixture() {
  const sha256 = "a".repeat(64);
  return {
    schemaVersion: 1,
    channel: "preview",
    gameId: "jinling-rumeng",
    releaseId: "season-01-production",
    contentVersion: "2026.07.11.video-first.1",
    entryNodeId: "S01-P00-CREATE",
    defaultLocale: "zh-CN",
    locales: ["en-US", "zh-CN", "zh-HK"],
    media: [
      {
        assetId: "P00-OPENING",
        kind: "video",
        orientationPolicy: "paired-required",
        variants: {
          landscape: {
            sourceAssetId: "SOURCE-OPENING-LANDSCAPE",
            sha256,
            src: "/jinling-rumeng/p00/opening-16x9.mp4",
            width: 1920,
            height: 1080,
            durationSeconds: 8,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
          portrait: {
            sourceAssetId: "SOURCE-OPENING-PORTRAIT",
            sha256,
            src: "/jinling-rumeng/p00/opening-9x16.mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 8,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
        },
        audio: "none",
      },
      {
        assetId: "P00-WAIT",
        kind: "video",
        orientationPolicy: "paired-required",
        variants: {
          landscape: {
            sourceAssetId: "SOURCE-WAIT-LANDSCAPE",
            sha256,
            src: "/jinling-rumeng/p00/wait-16x9.mp4",
            width: 1920,
            height: 1080,
            durationSeconds: 6,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
          portrait: {
            sourceAssetId: "SOURCE-WAIT-PORTRAIT",
            sha256,
            src: "/jinling-rumeng/p00/wait-9x16.mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 6,
            framesPerSecond: { numerator: 24, denominator: 1 },
            codec: "h264",
          },
        },
        audio: "none",
      },
      {
        assetId: "P00-POSTER",
        kind: "image",
        orientationPolicy: "paired-required",
        variants: {
          landscape: {
            sourceAssetId: "SOURCE-POSTER-LANDSCAPE",
            sha256,
            src: "/jinling-rumeng/p00/poster-16x9.png",
            width: 3840,
            height: 2160,
          },
          portrait: {
            sourceAssetId: "SOURCE-POSTER-PORTRAIT",
            sha256,
            src: "/jinling-rumeng/p00/poster-9x16.png",
            width: 2160,
            height: 3840,
          },
        },
      },
    ],
    nodes: [
      {
        nodeId: "S01-P00-CREATE",
        presentation: {
          kind: "video",
          sequence: [
            {
              clipId: "P00-OPENING-CLIP",
              assetId: "P00-OPENING",
              endBehavior: { assetId: "P00-WAIT", behavior: "loop" },
            },
          ],
          posterAssetId: "P00-POSTER",
          fit: "cover",
        },
        overlays: [
          {
            overlayId: "PLAYER-NAME",
            kind: "bound-text",
            binding: "player.displayName",
            landscapeSafeArea: { x: 0.55, y: 0.45, width: 0.3, height: 0.2 },
            portraitSafeArea: { x: 0.15, y: 0.55, width: 0.7, height: 0.18 },
          },
        ],
        exit: {
          kind: "external-overlay",
          rendererId: "jinling-profile-creator",
          routes: [{ actionId: "PROFILE-COMPLETED", effects: [], endingId: "P00-COMPLETE" }],
        },
      },
    ],
  };
}

function setSequenceEndBehavior(
  release: ReturnType<typeof fixture>,
  endBehavior: unknown,
  clipIndex = 0
): void {
  const clip = release.nodes[0]?.presentation.sequence[clipIndex] as
    | { endBehavior: unknown }
    | undefined;
  if (!clip) throw new Error(`Fixture is missing sequence clip ${clipIndex}`);
  clip.endBehavior = endBehavior;
}

test("parses a video-first release with independent wide and portrait masters", () => {
  const parsed = parseInteractiveFilmRelease(fixture());
  assert.equal(parsed.entryNodeId, "S01-P00-CREATE");
  assert.equal(parsed.media[0]?.kind, "video");
  assert.equal(parsed.nodes[0]?.presentation.kind, "video");
});

test("rejects a paired asset with a missing portrait master", () => {
  const release = fixture();
  delete (release.media[0].variants as { portrait?: unknown }).portrait;
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /independent landscape and portrait variants/
  );
});

test("rejects unknown or wrong-kind presentation assets", () => {
  const unknown = fixture();
  unknown.nodes[0].presentation.posterAssetId = "P00-MISSING";
  assert.throws(() => parseInteractiveFilmRelease(unknown), /Unknown media asset P00-MISSING/);

  const wrongKind = fixture();
  wrongKind.nodes[0].presentation.posterAssetId = "P00-WAIT";
  assert.throws(() => parseInteractiveFilmRelease(wrongKind), /must be image, received video/);

  const wrongClipPoster = fixture();
  (
    wrongClipPoster.nodes[0].presentation.sequence[0] as {
      posterAssetId?: string;
    }
  ).posterAssetId = "P00-WAIT";
  assert.throws(
    () => parseInteractiveFilmRelease(wrongClipPoster),
    /must be image, received video/
  );
});

test("rejects unsafe runtime URLs and overlays that escape their authored safe area", () => {
  const unsafe = fixture();
  unsafe.media[0].variants.landscape.src = "blob:temporary-video";
  assert.throws(() => parseInteractiveFilmRelease(unsafe), /root-relative or a permanent HTTPS/);

  const overflow = fixture();
  overflow.nodes[0].overlays[0].portraitSafeArea = {
    x: 0.5,
    y: 0.55,
    width: 0.7,
    height: 0.18,
  };
  assert.throws(() => parseInteractiveFilmRelease(overflow), /remain inside the frame/);
});

test("requires every branch target and reaction asset to resolve", () => {
  const release = fixture();
  (release.nodes[0] as { exit: unknown }).exit = {
    kind: "choice",
    trigger: { kind: "media-ended" },
    choices: [
      {
        choiceId: "Q-A",
        label: { "zh-CN": "向前" },
        effects: [],
        nextNodeId: "MISSING-A",
        afterSelect: { kind: "play", reactionAssetId: "P00-MISSING-REACTION" },
      },
      {
        choiceId: "Q-B",
        label: { "zh-CN": "停下" },
        effects: [],
        nextNodeId: "MISSING-B",
        afterSelect: { kind: "immediate" },
      },
    ],
  };
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Unknown target node MISSING-A|Unknown media asset P00-MISSING-REACTION/
  );
});

test("expresses a last-frame hold without inventing a second media asset", () => {
  const release = fixture();
  setSequenceEndBehavior(release, { behavior: "hold-last-frame" });
  const parsed = parseInteractiveFilmRelease(release);
  const presentation = parsed.nodes[0]?.presentation;
  assert.equal(presentation?.kind, "video");
  assert.deepEqual(presentation?.kind === "video" ? presentation.sequence[0]?.endBehavior : null, {
    behavior: "hold-last-frame",
  });
});

test("supports finite inter-shot holds but rejects indefinite waits before the last clip", () => {
  const release = fixture();
  const presentation = release.nodes[0].presentation;
  (presentation as { sequence: unknown[] }).sequence = [
    {
      clipId: "P00-OPENING-CLIP-A",
      assetId: "P00-OPENING",
      endBehavior: { behavior: "hold-last-frame", durationMs: 750 },
    },
    {
      clipId: "P00-OPENING-CLIP-B",
      assetId: "P00-OPENING",
      endBehavior: { behavior: "hold-last-frame" },
    },
  ];
  assert.equal(parseInteractiveFilmRelease(release).nodes[0]?.presentation.kind, "video");

  setSequenceEndBehavior(release, { behavior: "hold-last-frame" });
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Only the final clip may hold its last frame indefinitely/
  );
});

test("tail loops are final-only and cannot repeat embedded dialogue", () => {
  const release = fixture();
  release.media[0].audio = "embedded";
  setSequenceEndBehavior(release, {
    behavior: "loop-tail",
    tailSeconds: 1.5,
  });
  assert.throws(
    () => parseInteractiveFilmRelease(release),
    /Tail loops require a silent picture asset/
  );
  release.media[0].audio = "none";
  assert.equal(parseInteractiveFilmRelease(release).nodes[0]?.presentation.kind, "video");
});

test("rejects unreachable nodes and dangling external action targets", () => {
  const unreachable = fixture();
  (unreachable.nodes as unknown[]).push({
    ...unreachable.nodes[0],
    nodeId: "UNREACHABLE-NODE",
    exit: { kind: "ending", endingId: "UNREACHABLE-END" },
  });
  assert.throws(() => parseInteractiveFilmRelease(unreachable), /is unreachable from entry/);

  const dangling = fixture();
  (dangling.nodes[0] as { exit: unknown }).exit = {
    kind: "external-overlay",
    rendererId: "jinling-profile-creator",
    routes: [{ actionId: "PROFILE-COMPLETED", effects: [], nextNodeId: "MISSING-NODE" }],
  };
  assert.throws(() => parseInteractiveFilmRelease(dangling), /Unknown target node MISSING-NODE/);
});

test("resolves a seal overlay only to an immutable SVG runtime asset", () => {
  const release = fixture();
  (release.media as unknown[]).push({
    assetId: "P00-SEAL",
    kind: "data",
    sourceAssetId: "SOURCE-SEAL",
    sha256: "b".repeat(64),
    src: "/jinling-rumeng/p00/seal.svg",
    format: "svg",
  });
  (release.nodes[0].overlays as unknown[]).push({
    overlayId: "PLAYER-SEAL",
    kind: "seal",
    assetId: "P00-SEAL",
    landscapeSafeArea: { x: 0.7, y: 0.7, width: 0.1, height: 0.1 },
    portraitSafeArea: { x: 0.65, y: 0.7, width: 0.15, height: 0.1 },
  });

  assert.equal(parseInteractiveFilmRelease(release).media.at(-1)?.kind, "data");

  const wrongFormat = fixture();
  (wrongFormat.media as unknown[]).push({
    assetId: "P00-SEAL",
    kind: "data",
    sourceAssetId: "SOURCE-SEAL",
    sha256: "b".repeat(64),
    src: "/jinling-rumeng/p00/seal.json",
    format: "json",
  });
  (wrongFormat.nodes[0].overlays as unknown[]).push({
    overlayId: "PLAYER-SEAL",
    kind: "seal",
    assetId: "P00-SEAL",
    landscapeSafeArea: { x: 0.7, y: 0.7, width: 0.1, height: 0.1 },
    portraitSafeArea: { x: 0.65, y: 0.7, width: 0.15, height: 0.1 },
  });
  assert.throws(() => parseInteractiveFilmRelease(wrongFormat), /must be SVG/);
});
