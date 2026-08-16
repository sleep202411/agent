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
