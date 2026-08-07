import { describe, expect, it } from "vitest";

import { resolveProfile } from "./profiles.js";

describe("resolveProfile", () => {
  it("resolves creative-balanced to a concrete provider model", () => {
    expect(resolveProfile("creative-balanced").litellmModel).toBe("qwen-plus");
  });

  it("fails loud on unknown profile", () => {
    expect(() => resolveProfile("no-such-profile")).toThrow(/Unknown model profile/);
  });
});
