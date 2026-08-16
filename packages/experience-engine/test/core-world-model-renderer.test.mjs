import assert from "node:assert/strict";
import test from "node:test";
import { EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER } from "../dist/index.js";

const CONFIG = {
  projectId: "0197f4a2-0800-7000-8000-000000000001",
  worldId: "0197f4a2-0800-7000-8000-000000000002",
  entryInstruction: "Continue through the gate.",
  maxExperienceSeconds: 90,
  autoplay: true,
};

test("validates the provider-neutral world model renderer contract", () => {
  assert.doesNotThrow(() => EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.assertConfig(CONFIG));
  assert.throws(
    () =>
      EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.assertConfig({
        ...CONFIG,
        providerKey: "fal:happy-oyster",
      }),
    { code: "RENDERER_CONFIG_INVALID" }
  );
});

test("accepts only the declared world completion outcome and end command", () => {
  assert.equal(EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.supportsCommand("end"), true);
  assert.equal(
    EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.supportsOutcome("world-completed"),
    true
  );
  assert.doesNotThrow(() => EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.assertCommand("end", {}));
  assert.doesNotThrow(() =>
    EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.assertOutcome("world-completed", {})
  );
  assert.throws(
    () =>
      EXPERIENCE_CORE_WORLD_MODEL_RENDERER_ADAPTER.assertOutcome("world-completed", {
        unexpected: true,
      }),
    { code: "RENDERER_OUTCOME_INVALID" }
  );
});
