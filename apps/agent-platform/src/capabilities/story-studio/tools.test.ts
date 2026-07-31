import { describe, expect, it } from "vitest";

import { storyStudioCapabilityPack } from "./tools.js";

function tool(id: string) {
  const definition = storyStudioCapabilityPack.tools.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Story Studio capability pack has no ${id} tool`);
  return definition;
}

describe("durable source analysis read contract", () => {
  const analysis = () => tool("story_get_source_analysis");

  it("declares the read as non-blocking with the job's three terminal-or-not states", () => {
    const description = analysis().description;

    expect(description).toContain("never waits");
    for (const state of ["ready", "processing", "failed"]) {
      expect(description).toContain(`"${state}"`);
    }
    expect(description).toContain("progress.percent");
  });

  it("makes a not-ready analysis a successful read that must be relayed, not a dead end", () => {
    const contract = `${analysis().description}\n${storyStudioCapabilityPack.instructions}`;

    // The failure this encodes: the agent asked for a whole-script breakdown,
    // read an analysis that had barely started, and left the turn with nothing
    // for the creator while the background job kept climbing.
    expect(contract).toContain("story_query_source_material");
    expect(contract).toMatch(/never end a turn/iu);
    expect(contract).toMatch(/percent/iu);
    expect(contract).toMatch(/not an error|normal result|successful read/iu);
  });

  it("tells the agent the background job cannot be ready in the turn that uploads a document", () => {
    expect(storyStudioCapabilityPack.instructions).toMatch(/background job/iu);
    expect(storyStudioCapabilityPack.instructions).toMatch(
      /never ready in the turn that uploads/iu
    );
  });

  it("forbids polling the durable job inside one turn", () => {
    const contract = `${analysis().description}\n${storyStudioCapabilityPack.instructions}`;

    expect(contract).toMatch(/never poll/iu);
  });
});
