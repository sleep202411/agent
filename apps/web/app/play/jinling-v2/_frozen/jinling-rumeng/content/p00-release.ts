import {
  parseInteractiveFilmSceneRelease,
  type RuntimeDataAsset,
  type RuntimeImageAsset,
  type InteractiveFilmSceneNode,
  type RuntimeVideoAsset,
} from "../../interactive-film/domain/release-manifest";
import { jinlingP00Video } from "./media-release";

const FPS_24 = { numerator: 24, denominator: 1 } as const;

/**
 * Internal preview release for P00 media pairs that have completed provider
 * generation, exact-master validation and visual review. Production release
 * compilation remains blocked until every referenced source asset is formally
 * APPROVED.
 */
export const JINLING_P00_RELEASE = parseInteractiveFilmSceneRelease({
  schemaVersion: 1,
  channel: "preview",
  gameId: "jinling-rumeng",
  releaseId: "season-01-preview",
  contentVersion: "2026.07.12.p00-four-shot-preview.7",
  entryNodeId: "S01-P00-CREATE",
  defaultLocale: "zh-CN",
  locales: ["en-US", "zh-CN", "zh-HK"],
  media: [
    {
      assetId: "S01-P00-B01-VIDEO-WATER-ESTABLISHING",
      kind: "video",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B01-VIDEO-WATER-ESTABLISHING-CANDIDATE-V1",
          sha256: "399d3b4bda1235bd076c07bf6ad32bd1f3c97b98dac540a5f682f8dd5dcb8e75",
          src: jinlingP00Video("water-establishing-16x9-v01.mp4"),
          width: 1920,
          height: 1080,
          durationSeconds: 8,
          framesPerSecond: FPS_24,
          codec: "h264",
        },
      },
      audio: "none",
    },
    {
      assetId: "S01-P00-B02-VIDEO-OPENING",
      kind: "video",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B02-VIDEO-OPENING",
          sha256: "4e6abc914aade5c511026160f629bbff2943aa22a5d2c853bd63959f919d10da",
          src: jinlingP00Video("ledger-opening-16x9-v03.mp4"),
          width: 1920,
          height: 1080,
          durationSeconds: 12,
          framesPerSecond: FPS_24,
          codec: "h264",
        },
      },
      audio: "embedded",
    },
    {
      assetId: "S01-P00-B03-VIDEO-CONFIRM",
      kind: "video",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B03-VIDEO-CONFIRM",
          sha256: "c016bed985af4808eb6a2de9f070457a78d03804c1af218c0d9788a68cfe1a62",
          src: jinlingP00Video("ledger-confirm-16x9-v03.mp4"),
          width: 1920,
          height: 1080,
          durationSeconds: 6,
          framesPerSecond: FPS_24,
          codec: "h264",
        },
      },
      audio: "embedded",
    },
    {
      assetId: "S01-P00-B04-VIDEO-TRANSITION",
      kind: "video",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B04-VIDEO-TRANSITION-CANDIDATE-V1",
          sha256: "6b87e2f08e9ca2a33b140fa606a9f75f33aebbc8e6f9562935dba0c73d3f17fa",
          src: jinlingP00Video("ledger-to-carriage-transition-16x9-v01.mp4"),
          width: 1920,
          height: 1080,
          durationSeconds: 12,
          framesPerSecond: FPS_24,
          codec: "h264",
        },
      },
      audio: "none",
    },
    {
      assetId: "S01-P00-B02-IMG-MATTE-TAIXU",
      kind: "image",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B02-IMG-MATTE-TAIXU-16X9",
          sha256: "fafbaff4f74d9361e4254e1b4357c05d4b758715002e320f4b220d73d05eabea",
          src: "/jinling-rumeng/production/p00/environment/taixu-matte-16x9-v01.png",
          width: 3840,
          height: 2160,
        },
      },
    },
    {
      assetId: "S01-P00-B03-IMG-CONFIRM-FIRST",
      kind: "image",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B03-IMG-CONFIRM-FIRST-16X9",
          sha256: "4ccf25a959157016f4d68bcd18ced327891fbc630355f8be6763903e8a7a5fc2",
          src: "/jinling-rumeng/production/p00/continuity/opening-hold-16x9-v01.png",
          width: 1920,
          height: 1080,
        },
      },
    },
    {
      assetId: "S01-P00-B04-IMG-CONFIRM-FINAL",
      kind: "image",
      orientationPolicy: "single-master",
      variants: {
        landscape: {
          sourceAssetId: "S01-P00-B04-REF-CONFIRM-FINAL-V1",
          sha256: "0322c15d9107357cec501ef96ff1ad55db4f428123e7197621633319c5ecf2b0",
          src: "/jinling-rumeng/production/p00/continuity/confirm-final-16x9-v01.png",
          width: 1920,
          height: 1080,
        },
      },
    },
    {
      assetId: "S01-P00-B03-TEXTURE-SEAL-MASK",
      kind: "data",
      sourceAssetId: "S01-P00-B03-TEXTURE-SEAL-MASK",
      sha256: "09b260c853282ad939f1c8b85ee141e80502fb820ecd9ec2d14099c6ae598bf2",
      src: "/jinling-rumeng/production/p00/seal/seal-mask-v01.svg",
      format: "svg",
    },
  ],
  nodes: [
    {
      nodeId: "S01-P00-CREATE",
      presentation: {
        kind: "video",
        sequence: [
          {
            clipId: "S01-P00-B01-WATER-ESTABLISHING-CLIP",
            assetId: "S01-P00-B01-VIDEO-WATER-ESTABLISHING",
            endBehavior: { behavior: "advance" },
          },
          {
            clipId: "S01-P00-B02-OPENING-CLIP",
            assetId: "S01-P00-B02-VIDEO-OPENING",
            endBehavior: { behavior: "hold-last-frame" },
          },
        ],
        posterAssetId: "S01-P00-B02-IMG-MATTE-TAIXU",
        fit: "contain",
      },
      overlays: [
        {
          overlayId: "S01-P00-PROFILE-CREATOR",
          kind: "interaction",
          landscapeSafeArea: { x: 0.03, y: 0.08, width: 0.94, height: 0.86 },
          portraitSafeArea: { x: 0.03, y: 0.08, width: 0.94, height: 0.86 },
        },
      ],
      exit: {
        kind: "external-overlay",
        rendererId: "jinling-profile-creator",
        routes: [
          {
            actionId: "PROFILE-COMPLETED",
            effects: [{ kind: "set_flag", flag: "p00ProfileCreated", value: true }],
            nextNodeId: "S01-P00-CONFIRM",
          },
        ],
      },
    },
    {
      nodeId: "S01-P00-CONFIRM",
      presentation: {
        kind: "video",
        sequence: [
          {
            clipId: "S01-P00-B03-CONFIRM-CLIP",
            assetId: "S01-P00-B03-VIDEO-CONFIRM",
            endBehavior: { behavior: "advance" },
          },
          {
            clipId: "S01-P00-B04-TRANSITION-CLIP",
            assetId: "S01-P00-B04-VIDEO-TRANSITION",
            posterAssetId: "S01-P00-B04-IMG-CONFIRM-FINAL",
            endBehavior: { behavior: "hold-last-frame" },
          },
        ],
        posterAssetId: "S01-P00-B03-IMG-CONFIRM-FIRST",
        fit: "contain",
      },
      overlays: [
        {
          overlayId: "S01-P00-PLAYER-NAME",
          kind: "bound-text",
          binding: "player.displayName",
          landscapeSafeArea: { x: 0.58, y: 0.62, width: 0.22, height: 0.12 },
          portraitSafeArea: { x: 0.56, y: 0.61, width: 0.3, height: 0.1 },
        },
        {
          overlayId: "S01-P00-SEAL",
          kind: "seal",
          assetId: "S01-P00-B03-TEXTURE-SEAL-MASK",
          landscapeSafeArea: { x: 0.7, y: 0.72, width: 0.08, height: 0.14 },
          portraitSafeArea: { x: 0.69, y: 0.68, width: 0.14, height: 0.1 },
        },
      ],
      exit: { kind: "ending", endingId: "P00-PREVIEW-COMPLETE" },
    },
  ],
});

export function p00MediaAsset(assetId: string) {
  const asset = JINLING_P00_RELEASE.media.find((candidate) => candidate.assetId === assetId);
  if (!asset) throw new Error(`Missing P00 runtime media asset ${assetId}`);
  return asset;
}

export function p00VideoAsset(assetId: string): RuntimeVideoAsset {
  const asset = p00MediaAsset(assetId);
  if (asset.kind !== "video") throw new Error(`P00 media ${assetId} is not a video`);
  return asset;
}

export function p00ImageAsset(assetId: string): RuntimeImageAsset {
  const asset = p00MediaAsset(assetId);
  if (asset.kind !== "image") throw new Error(`P00 media ${assetId} is not an image`);
  return asset;
}

export function p00DataAsset(assetId: string): RuntimeDataAsset {
  const asset = p00MediaAsset(assetId);
  if (asset.kind !== "data") throw new Error(`P00 media ${assetId} is not data`);
  return asset;
}

export function p00SceneNode(nodeId: string): InteractiveFilmSceneNode {
  const node = JINLING_P00_RELEASE.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new Error(`Missing P00 runtime scene node ${nodeId}`);
  return node;
}
