import { describe, expect, it } from "vitest";

import { requiresApproval, riskForCanvasTool } from "./index.js";

describe("requiresApproval", () => {
  it("allows read in every mode without approval", () => {
    for (const mode of ["DISCUSS", "ASSIST", "AUTOPILOT"] as const) {
      expect(requiresApproval({ mode, permissionMode: "ask", risk: "read" }).required).toBe(false);
    }
  });

  it("blocks side effects in DISCUSS", () => {
    const result = requiresApproval({
      mode: "DISCUSS",
      permissionMode: "full",
      risk: "reversible",
    });
    expect(result.required).toBe(true);
  });

  it("always requires approval for critical", () => {
    expect(
      requiresApproval({
        mode: "AUTOPILOT",
        permissionMode: "full",
        risk: "critical",
      }).required
    ).toBe(true);
  });

  it("smart mode auto-runs reversible but not sensitive", () => {
    expect(
      requiresApproval({
        mode: "ASSIST",
        permissionMode: "smart",
        risk: "reversible",
      }).required
    ).toBe(false);
    expect(
      requiresApproval({
        mode: "ASSIST",
        permissionMode: "smart",
        risk: "sensitive",
      }).required
    ).toBe(true);
  });

  it("advertises only approval actions implemented end to end", () => {
    for (const input of [
      { mode: "AUTOPILOT", permissionMode: "full", risk: "critical" },
      { mode: "ASSIST", permissionMode: "ask", risk: "reversible" },
      { mode: "ASSIST", permissionMode: "smart", risk: "sensitive" },
    ] as const) {
      const result = requiresApproval(input);
      expect(result).toMatchObject({ required: true, actions: ["approve", "reject"] });
    }
  });

  it("maps canvas.applyPatch to sensitive", () => {
    expect(riskForCanvasTool("canvas.applyPatch")).toBe("sensitive");
    expect(riskForCanvasTool("canvas.read")).toBe("read");
    expect(riskForCanvasTool("unknown.tool")).toBe("critical");
  });
});

it.each(["constructor", "toString", "__proto__"])(
  "classifies unknown inherited name %s conservatively",
  (id) => {
    expect(riskForCanvasTool(id)).toBe("critical");
  }
);
