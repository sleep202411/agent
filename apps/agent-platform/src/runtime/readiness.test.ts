import { describe, expect, it } from "vitest";

import { summarizeReadiness } from "./readiness.js";

describe("summarizeReadiness", () => {
  it("keeps serving during an observability-only outage", () => {
    expect(
      summarizeReadiness({
        otelCollector: "unavailable",
        temporal: "ready",
        agentMemory: "ready",
        domainGateway: "ready",
      })
    ).toEqual({ ready: true, degraded: true });
  });

  it("removes a replica when a critical execution dependency is unavailable", () => {
    expect(
      summarizeReadiness({
        otelCollector: "ready",
        temporal: "unavailable",
        agentMemory: "ready",
        domainGateway: "ready",
      })
    ).toEqual({ ready: false, degraded: true });
  });

  it("removes a replica when durable agent memory is unavailable", () => {
    expect(
      summarizeReadiness({
        otelCollector: "ready",
        temporal: "ready",
        agentMemory: "unavailable",
        domainGateway: "ready",
      })
    ).toEqual({ ready: false, degraded: true });
  });
});
