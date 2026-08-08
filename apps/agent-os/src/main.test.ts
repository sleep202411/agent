import { describe, expect, it } from "vitest";

import { agentOsIdentity } from "./main.js";

describe("agentOsIdentity", () => {
  it("names the product and pins free tier + LangGraph runtime", () => {
    const identity = agentOsIdentity();
    expect(identity.product).toBe("FizzDragon Agent Platform");
    expect(identity.codename).toBe("Agent OS");
    expect(identity.protocolVersion).toBe("fizz.agent.v1");
    expect(identity.runtime).toContain("langgraph");
    expect(identity.billing).toBe("free");
    expect(identity.rateLimit).toBe("disabled");
    expect(identity.phase1Tools).toContain("characters.upsert");
  });
});
