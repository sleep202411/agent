import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import path from "node:path";
import { promisify } from "node:util";
import { JINLING_P00_RELEASE } from "./p00-release";

const PUBLIC_ROOT = fileURLToPath(new URL("../../../../public/", import.meta.url));
const MEDIA_RELEASE_MANIFEST = fileURLToPath(
  new URL("../production/manifests/s01-azure-media-release-v1.json", import.meta.url)
);
const execFileAsync = promisify(execFile);

test("P00 preview exposes only real video-first media and no GLB dependency", () => {
  assert.equal(JINLING_P00_RELEASE.channel, "preview");
  assert.equal(JINLING_P00_RELEASE.entryNodeId, "S01-P00-CREATE");
  assert.equal(JINLING_P00_RELEASE.nodes.length, 2);
  assert.ok(JINLING_P00_RELEASE.nodes.every((node) => node.presentation.kind === "video"));
  assert.ok(
    JINLING_P00_RELEASE.media.every((asset) =>
      asset.kind === "video" || asset.kind === "image"
        ? Object.values(asset.variants).every((variant) => !variant?.src.endsWith(".glb"))
        : true
    )
  );
});

test("P00 publishes landscape masters only", () => {
  for (const asset of JINLING_P00_RELEASE.media) {
    if (asset.kind === "data") continue;
    assert.equal(asset.orientationPolicy, "single-master");
    assert.ok(asset.variants.landscape);
    assert.equal(asset.variants.portrait, undefined);
  }
});

test("P00 runtime videos contain the approved preview mix", () => {
  const videos = JINLING_P00_RELEASE.media.filter((asset) => asset.kind === "video");
  assert.equal(videos.length, 4);
  const silentPictureIds = new Set([
    "S01-P00-B01-VIDEO-WATER-ESTABLISHING",
    "S01-P00-B04-VIDEO-TRANSITION",
  ]);
  assert.ok(
    videos
      .filter((video) => silentPictureIds.has(video.assetId))
      .every((video) => video.audio === "none")
  );
  const runtimeMixes = videos.filter((video) => !silentPictureIds.has(video.assetId));
  assert.ok(runtimeMixes.every((video) => video.audio === "embedded"));
  assert.ok(runtimeMixes.every((video) => video.variants.landscape?.src.endsWith("-16x9-v03.mp4")));
});

test("P00 runtime muxes preserve every authored picture frame", async () => {
  const videos = JINLING_P00_RELEASE.media.filter((asset) => asset.kind === "video");
  for (const video of videos) {
    const variant = video.variants.landscape;
    assert.ok(variant);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,nb_frames,duration",
      "-of",
      "json",
      variant.src,
    ]);
    const metadata = JSON.parse(stdout) as {
      streams?: Array<{
        width?: number;
        height?: number;
        r_frame_rate?: string;
        nb_frames?: string;
        duration?: string;
      }>;
    };
    const stream = metadata.streams?.[0];
    assert.ok(stream);
    assert.equal(stream.width, variant.width);
    assert.equal(stream.height, variant.height);
    assert.equal(stream.r_frame_rate, "24/1");
    assert.equal(Number(stream.nb_frames), variant.durationSeconds * 24);
    assert.equal(Number(stream.duration), variant.durationSeconds);
  }
});

test("P00 explicitly holds the opening master instead of declaring a missing WAIT clip", () => {
  const presentation = JINLING_P00_RELEASE.nodes[0]?.presentation;
  assert.equal(presentation?.kind, "video");
  assert.equal(presentation?.kind === "video" ? presentation.sequence.length : 0, 2);
  assert.deepEqual(presentation?.kind === "video" ? presentation.sequence[0]?.endBehavior : null, {
    behavior: "advance",
  });
  assert.deepEqual(presentation?.kind === "video" ? presentation.sequence[1]?.endBehavior : null, {
    behavior: "hold-last-frame",
  });
  assert.equal(presentation?.kind === "video" ? presentation.fit : null, "contain");
});

test("P00 confirm advances into an exact-poster transition before holding for SC01", () => {
  const presentation = JINLING_P00_RELEASE.nodes[1]?.presentation;
  assert.equal(presentation?.kind, "video");
  assert.equal(presentation?.kind === "video" ? presentation.sequence.length : 0, 2);
  assert.deepEqual(presentation?.kind === "video" ? presentation.sequence[0]?.endBehavior : null, {
    behavior: "advance",
  });
  assert.deepEqual(presentation?.kind === "video" ? presentation.sequence[1] : null, {
    clipId: "S01-P00-B04-TRANSITION-CLIP",
    assetId: "S01-P00-B04-VIDEO-TRANSITION",
    posterAssetId: "S01-P00-B04-IMG-CONFIRM-FINAL",
    endBehavior: { behavior: "hold-last-frame" },
  });
});

test("every P00 preview visual resolves to the immutable source hash", async () => {
  const mediaRelease = JSON.parse(await readFile(MEDIA_RELEASE_MANIFEST, "utf8")) as {
    assets: Array<{ publicUrl: string; sha256: string }>;
  };
  const publishedHashes = new Map(
    mediaRelease.assets.map((asset) => [asset.publicUrl, asset.sha256])
  );

  for (const asset of JINLING_P00_RELEASE.media) {
    if (asset.kind === "data") {
      const bytes = await readFile(path.join(PUBLIC_ROOT, asset.src.slice(1)));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
      continue;
    }
    for (const variant of Object.values(asset.variants)) {
      if (!variant) continue;
      if (variant.src.startsWith("https://")) {
        assert.equal(publishedHashes.get(variant.src), variant.sha256);
        continue;
      }
      const bytes = await readFile(path.join(PUBLIC_ROOT, variant.src.slice(1)));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), variant.sha256);
    }
  }
});

test("profile completion remains a controlled HTML interaction action", () => {
  const node = JINLING_P00_RELEASE.nodes[0];
  assert.ok(node?.overlays.some((overlay) => overlay.kind === "interaction"));
  assert.equal(node?.exit.kind, "external-overlay");
  assert.equal(
    node?.exit.kind === "external-overlay" ? node.exit.routes[0]?.actionId : null,
    "PROFILE-COMPLETED"
  );
  const route = node?.exit.kind === "external-overlay" ? node.exit.routes[0] : null;
  assert.ok(route && "nextNodeId" in route);
  assert.equal(route.nextNodeId, "S01-P00-CONFIRM");
});

test("CONFIRM keeps player identity and the controlled seal outside generated video", () => {
  const confirm = JINLING_P00_RELEASE.nodes.find((node) => node.nodeId === "S01-P00-CONFIRM");
  assert.ok(confirm);
  assert.ok(
    confirm.overlays.some(
      (overlay) => overlay.kind === "bound-text" && overlay.binding === "player.displayName"
    )
  );
  assert.ok(
    confirm.overlays.some(
      (overlay) => overlay.kind === "seal" && overlay.assetId === "S01-P00-B03-TEXTURE-SEAL-MASK"
    )
  );
});
