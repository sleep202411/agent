import { describe, expect, it } from "vitest";

import { MODEL_PROFILE_ID_MAX_LENGTH, isModelProfileId } from "@repo/shared";
import { loadModelProfiles, resolveProfile } from "./profiles.js";

/**
 * Adding a model must be a configuration change, not a release. These pin the
 * two halves of that: the shipped list works out of the box, and an operator
 * can replace it — loudly failing if they get it wrong, because a picker that
 * silently ignored a bad override would hide the only thing they need to know.
 */
describe("model profiles", () => {
  it("ships models that have been probed against the endpoint", () => {
    const ids = loadModelProfiles({}).map((p) => p.id);
    expect(ids).toContain("qwen3.7-plus");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("glm-5.2");
  });

  it("gives every model a name a person can read", () => {
    for (const profile of loadModelProfiles({})) {
      expect(profile.label.length).toBeGreaterThan(0);
      // A model name is a proper noun — it must not look like an id.
      expect(profile.label).not.toBe(profile.id);
    }
  });

  it("lets the environment replace the list wholesale", () => {
    const env = {
      AGENT_OS_MODEL_PROFILES: JSON.stringify([
        { id: "house-model", model: "some-provider-model", label: "House" },
      ]),
    };
    expect(loadModelProfiles(env).map((p) => p.id)).toEqual(["house-model"]);
    expect(resolveProfile("house-model", env).model).toBe("some-provider-model");
    // The shipped list is replaced, not merged — a half-overridden picker is
    // impossible to reason about from the deployment alone.
    expect(() => resolveProfile("qwen3.7-plus", env)).toThrow(/Unknown model profile/);
  });

  it("applies defaults for the tuning fields an operator omits", () => {
    const env = {
      AGENT_OS_MODEL_PROFILES: JSON.stringify([{ id: "minimal", model: "m", label: "Minimal" }]),
    };
    const profile = resolveProfile("minimal", env);
    expect(profile.temperature).toBeGreaterThan(0);
    expect(profile.maxTokens).toBeGreaterThan(0);
  });

  it("refuses a malformed override instead of pretending it took", () => {
    expect(() => loadModelProfiles({ AGENT_OS_MODEL_PROFILES: "{oops" })).toThrow(/not valid JSON/);
    expect(() =>
      loadModelProfiles({ AGENT_OS_MODEL_PROFILES: JSON.stringify([{ id: "x" }]) })
    ).toThrow();
    expect(() =>
      loadModelProfiles({
        AGENT_OS_MODEL_PROFILES: JSON.stringify([
          { id: "dup", model: "a", label: "A" },
          { id: "dup", model: "b", label: "B" },
        ]),
      })
    ).toThrow(/duplicate id/);
  });

  it("names the available models when asked for one that does not exist", () => {
    expect(() => resolveProfile("not-a-model", {})).toThrow(/Available:/);
  });
  // The bug this pins: shipped ids contained `.` (qwen3.7-plus, glm-5.2) while
  // the Nest gateway and the protocol package each carried their own narrower
  // copy of the pattern. Every run died at the gateway with a raw ZodError and
  // the models were never reached. Adding a profile the wire cannot carry must
  // fail here, not in production.
  it("ships only ids the wire can actually carry", () => {
    for (const profile of loadModelProfiles({})) {
      expect(isModelProfileId(profile.id)).toBe(true);
      expect(profile.id.length).toBeLessThanOrEqual(MODEL_PROFILE_ID_MAX_LENGTH);
    }
  });

  it("accepts a dot in an id — the shipped defaults depend on it", () => {
    expect(isModelProfileId("qwen3.7-plus")).toBe(true);
    expect(isModelProfileId("Qwen-Plus")).toBe(false);
    expect(isModelProfileId("3-leading-digit")).toBe(false);
  });
});
