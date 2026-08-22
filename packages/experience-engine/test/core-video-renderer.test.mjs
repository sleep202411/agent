import assert from "node:assert/strict";
import test from "node:test";
import { EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER } from "../dist/index.js";

test("accepts the core.video playback and seek command contract", () => {
  assert.equal(EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.supportsCommand("play"), true);
  assert.equal(EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.supportsCommand("pause"), true);
  assert.equal(EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.supportsCommand("seek"), true);
  assert.equal(EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.supportsCommand("rewind"), false);

  assert.doesNotThrow(() => EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("play", {}));
  assert.doesNotThrow(() => EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("pause", {}));
  assert.doesNotThrow(() =>
    EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("seek", { timeMs: 1_250 })
  );
});

test("rejects malformed or unsupported core.video commands", () => {
  assert.throws(
    () => EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("play", { unexpected: true }),
    { code: "RENDERER_COMMAND_INVALID" }
  );
  assert.throws(
    () => EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("seek", { timeMs: -1 }),
    { code: "RENDERER_COMMAND_INVALID" }
  );
  assert.throws(
    () => EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("seek", { timeMs: "1250" }),
    { code: "RENDERER_COMMAND_INVALID" }
  );
  assert.throws(() => EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.assertCommand("rewind", {}), {
    code: "RENDERER_COMMAND_UNSUPPORTED",
  });
});

test("leaves the still capability to the host, not the shared adapter", () => {
  // Every host registers this adapter, including native ones whose renderer
  // draws footage only. If the adapter claimed core.video.still, those hosts
  // would silently claim to render stills the moment they rebuild, and a
  // still-bearing manifest would play as an empty frame instead of being
  // refused by name.
  assert.equal(
    EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.capabilities.has("core.video.still"),
    false
  );
  assert.equal(EXPERIENCE_CORE_VIDEO_RENDERER_ADAPTER.capabilities.has("core.video"), true);
});
