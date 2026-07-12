import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeImageAsset } from "../domain/release-manifest";
import {
  projectNormalizedSafeAreaToViewport,
  selectResponsiveVisualVariant,
  visualOrientationForViewport,
} from "./responsive-media";

const PAIRED: RuntimeImageAsset = {
  assetId: "PAIRED-POSTER",
  kind: "image",
  orientationPolicy: "paired-required",
  variants: {
    landscape: {
      sourceAssetId: "SOURCE-WIDE",
      sha256: "a".repeat(64),
      src: "/wide.png",
      width: 1920,
      height: 1080,
    },
    portrait: {
      sourceAssetId: "SOURCE-PORTRAIT",
      sha256: "b".repeat(64),
      src: "/portrait.png",
      width: 1080,
      height: 1920,
    },
  },
};

test("selects orientation from the viewport and never crops a paired master by accident", () => {
  assert.equal(visualOrientationForViewport(1440, 900), "landscape");
  assert.equal(visualOrientationForViewport(390, 844), "portrait");
  assert.equal(selectResponsiveVisualVariant(PAIRED, "landscape").src, "/wide.png");
  assert.equal(selectResponsiveVisualVariant(PAIRED, "portrait").src, "/portrait.png");
});

test("single-master reuse must be explicit", () => {
  const single: RuntimeImageAsset = {
    assetId: "SINGLE-POSTER",
    kind: "image",
    orientationPolicy: "single-master",
    variants: {
      landscape: {
        sourceAssetId: "SOURCE-SINGLE",
        sha256: "c".repeat(64),
        src: "/single.png",
        width: 1920,
        height: 1080,
      },
    },
  };
  assert.equal(selectResponsiveVisualVariant(single, "portrait").src, "/single.png");

  const brokenPaired: RuntimeImageAsset = {
    ...single,
    assetId: "BROKEN-PAIRED",
    orientationPolicy: "paired-required",
  };
  assert.throws(
    () => selectResponsiveVisualVariant(brokenPaired, "portrait"),
    /no portrait variant/
  );
});

test("projects an authored safe area unchanged at the source aspect ratio", () => {
  assert.deepEqual(
    projectNormalizedSafeAreaToViewport(
      { x: 0.5, y: 0.25, width: 0.2, height: 0.1 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      "cover"
    ),
    { left: 640, top: 180, width: 256, height: 72 }
  );
});

test("projects through horizontal cover cropping instead of viewport percentages", () => {
  const projected = projectNormalizedSafeAreaToViewport(
    { x: 0.5, y: 0.25, width: 0.2, height: 0.1 },
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    "cover"
  );
  assert.ok(Math.abs(projected.left - 512) < 1e-9);
  assert.ok(Math.abs(projected.top - 192) < 1e-9);
  assert.ok(Math.abs(projected.width - 273.06666666666666) < 1e-9);
  assert.ok(Math.abs(projected.height - 76.8) < 1e-9);
});

test("projects portrait safe areas against the independent portrait master", () => {
  assert.deepEqual(
    projectNormalizedSafeAreaToViewport(
      { x: 0.2, y: 0.6, width: 0.4, height: 0.1 },
      { width: 1080, height: 1920 },
      { width: 360, height: 640 },
      "cover"
    ),
    { left: 72, top: 384, width: 144, height: 64 }
  );
});

test("rejects invalid projection dimensions", () => {
  assert.throws(
    () =>
      projectNormalizedSafeAreaToViewport(
        { x: 0, y: 0, width: 1, height: 1 },
        { width: 0, height: 1080 },
        { width: 1280, height: 720 },
        "cover"
      ),
    /dimensions must be positive/
  );
});
