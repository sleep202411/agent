import { describe, expect, it } from "vitest";

import {
  accessPresetForPolicyKeys,
  isCrewAccessPreset,
  isCrewInviteAccessPreset,
  policyKeysForAccessPreset,
} from "./member-access-preset";

describe("crew member access presets", () => {
  it.each([
    ["standard", []],
    ["finance", ["finance"]],
    ["admin", ["admin"]],
    ["admin_finance", ["admin", "finance"]],
  ] as const)("maps %s to atomic policies", (preset, expected) => {
    expect(policyKeysForAccessPreset(preset)).toEqual(expected);
  });

  it("recognizes combined policies independently of their order", () => {
    expect(accessPresetForPolicyKeys(["finance", "admin"])).toBe("admin_finance");
  });

  it("rejects values outside the declared presets", () => {
    expect(isCrewAccessPreset("owner")).toBe(false);
    expect(isCrewAccessPreset("admin_finance")).toBe(true);
    expect(isCrewInviteAccessPreset("admin_finance")).toBe(false);
    expect(isCrewInviteAccessPreset("admin")).toBe(true);
  });
});
