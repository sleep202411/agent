import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type {
  CreatorDiscoveryRequest,
  CreatorDiscoveryResult,
} from "@repo/shared/creator-location";
import { runDiscoveryAgent } from "./discovery-agent.js";
import type { DiscoveryToolHost } from "./discovery-tools.js";
class ScriptedModel extends BaseChatModel {
  constructor(readonly responses: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "scripted-discovery-test";
  }
  bindTools() {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    const message = this.responses.shift();
    if (!message) throw new Error("No scripted response");
    return {
      generations: [{ text: typeof message.content === "string" ? message.content : "", message }],
    };
  }
}
const query = {
  basedIn: { countryCode: "SG", city: "Singapore" },
  serves: null,
  remoteOnly: false,
  availableForWork: false,
  category: null,
  text: "advertising",
};
const ipQuery = {
  schemaVersion: 1,
  location: null,
  era: null,
  duration: null,
  genreCodes: [],
  moodPreferences: [],
};
const queryId = "a".repeat(64);
const card = {
  id: "studio-1",
  name: "Studio",
  avatarUrl: "",
  openToWork: true,
  matched: true,
  basedIn: query.basedIn,
  serves: [],
  remote: false,
  showOnMap: true,
  point: null,
  serviceCount: 2,
  matchingServiceCount: 1,
};
const search = (args: object = { query }) =>
  new AIMessage({
    content: "",
    tool_calls: [{ id: randomUUID(), name: "discovery_searchCreators", args, type: "tool_call" }],
  });
const answer = (ids = [card.id]) =>
  new AIMessage(JSON.stringify({ status: "results", queryId, ids }));
function fixture(responses: AIMessage[]) {
  const port = {
    searchIps: vi.fn(),
    searchCreators: vi.fn(
      async (r: CreatorDiscoveryRequest): Promise<CreatorDiscoveryResult> => ({
        requestId: r.requestId,
        queryId,
        query: r.query,
        items: [card],
        selected: r.selectedCreatorId ? card : null,
        nextCursor: null,
        matchedCount: 1,
        accessibleCount: 8,
        requiresLogin: false,
        island: { creatorCount: 8, matchedCreatorCount: 1 },
        countScope: "public_platform_creators_with_listed_services",
        map: null,
      })
    ),
  };
  const host: DiscoveryToolHost = { locale: "en-US", coordinateSystem: "WGS84", port };
  return {
    port,
    input: {
      conversation: {
        current: { kind: "creators", query },
        messages: [{ role: "user", content: "Find advertising studios based in Singapore" }],
      },
      model: new ScriptedModel(responses),
      host,
      genres: [],
      signal: new AbortController().signal,
    },
  };
}
describe("discovery LangGraph turn", () => {
  it("runs registered search and rechecks selected cards before returning criteria/facts", async () => {
    const { input, port } = fixture([search(), answer()]);
    const result = await runDiscoveryAgent(input);
    expect(result).toMatchObject({
      kind: "creators",
      query,
      cards: [card],
      matchedCount: 1,
      accessibleCount: 8,
    });
    expect(port.searchCreators).toHaveBeenCalledTimes(2);
    expect(port.searchCreators.mock.calls[1]?.[0]).toMatchObject({ selectedCreatorId: card.id });
    expect(result).not.toHaveProperty("score");
  });
  it("allows clarification without querying or inventing results", async () => {
    const { input, port } = fixture([
      new AIMessage(
        JSON.stringify({
          status: "clarification",
          question: "Based in Singapore, or serving Singapore?",
        })
      ),
    ]);
    await expect(runDiscoveryAgent(input)).resolves.toMatchObject({ status: "clarification" });
    expect(port.searchCreators).not.toHaveBeenCalled();
  });
  it("does not present recalled IDs without a current query", async () => {
    const { input } = fixture([answer()]);
    await expect(runDiscoveryAgent(input)).rejects.toThrow("latest search");
  });
  it.each([["invented"], [card.id, card.id], []])(
    "rejects unsupported recommendation IDs %j",
    async (...ids) => {
      const { input } = fixture([search(), answer(ids)]);
      await expect(runDiscoveryAgent(input)).rejects.toThrow();
    }
  );
  it("rejects a recommendation revoked between the tool read and final response", async () => {
    const { input, port } = fixture([search(), answer()]);
    const original = port.searchCreators.getMockImplementation()!;
    port.searchCreators.mockImplementation(async (r) => ({
      ...(await original(r)),
      selected: null,
    }));
    await expect(runDiscoveryAgent(input)).rejects.toThrow("results changed");
  });
  it("returns no matches even when the catalogue contains unrelated studios", async () => {
    const { input, port } = fixture([search(), answer([])]);
    const original = port.searchCreators.getMockImplementation()!;
    port.searchCreators.mockImplementation(async (r) => ({
      ...(await original(r)),
      items: [],
      matchedCount: 0,
    }));
    await expect(runDiscoveryAgent(input)).resolves.toMatchObject({
      cards: [],
      matchedCount: 0,
      accessibleCount: 8,
    });
    expect(port.searchCreators).toHaveBeenCalledTimes(2);
  });
  it("fails rather than returning counts that changed during final validation", async () => {
    const { input, port } = fixture([search(), answer()]);
    const original = port.searchCreators.getMockImplementation()!;
    port.searchCreators.mockImplementation(async (r) => ({
      ...(await original(r)),
      matchedCount: r.selectedCreatorId ? 2 : 1,
    }));
    await expect(runDiscoveryAgent(input)).rejects.toThrow("results changed");
  });
  it("does not expose the other mode's tool", async () => {
    const { input, port } = fixture([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "bad", name: "discovery_searchIps", args: { query: ipQuery }, type: "tool_call" },
        ],
      }),
    ]);
    await expect(runDiscoveryAgent(input)).rejects.toThrow();
    expect(port.searchIps).not.toHaveBeenCalled();
  });
  it("rejects invented place keys before calling the host", async () => {
    const { input, port } = fixture([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "bad",
            name: "discovery_searchIps",
            args: {
              query: {
                ...ipQuery,
                location: { kind: "story_setting", relation: "any", placeIds: ["invented"] },
              },
            },
            type: "tool_call",
          },
        ],
      }),
    ]);
    input.conversation = {
      current: { kind: "ips", query: ipQuery },
      messages: [{ role: "user", content: "Singapore" }],
    } as unknown as typeof input.conversation;
    await expect(runDiscoveryAgent(input)).rejects.toThrow("Discover a catalogue place");
    expect(port.searchIps).not.toHaveBeenCalled();
  });
  it("bounds requests without truncating the user's criteria", async () => {
    const { input, port } = fixture([]);
    input.conversation.messages[0]!.content = "x".repeat(2001);
    await expect(runDiscoveryAgent(input)).rejects.toThrow();
    expect(port.searchCreators).not.toHaveBeenCalled();
  });
  it("limits repeated catalogue exploration even if the model keeps requesting tools", async () => {
    const { input, port } = fixture(Array.from({ length: 8 }, () => search()));
    await expect(runDiscoveryAgent(input)).rejects.toThrow("search limit reached");
    expect(port.searchCreators).toHaveBeenCalledTimes(6);
  });
  it("cancels a stalled model without returning a stale answer", async () => {
    const { input, port } = fixture([]);
    const controller = new AbortController();
    input.signal = controller.signal;
    vi.spyOn(input.model, "_generate").mockImplementation(() => new Promise(() => {}));
    const pending = runDiscoveryAgent(input);
    controller.abort(new Error("Account replaced"));
    await expect(pending).rejects.toThrow("Account replaced");
    expect(port.searchCreators).not.toHaveBeenCalled();
  });
  it("discovers place keys then searches the full IP query with approved duration/era semantics", async () => {
    const placeId = "story_setting:singapore";
    const filtered = {
      ...ipQuery,
      location: { kind: "story_setting", relation: "any", placeIds: [placeId] },
      era: {
        calendar: "proleptic_gregorian_astronomical",
        startYear: 1980,
        endYear: 2000,
        relation: "overlaps",
      },
      duration: { unit: "episode", maxSeconds: 900, unknown: "exclude" },
      genreCodes: ["romance"],
    };
    const ipId = "11111111-1111-4111-8111-111111111111";
    const call = (args: object) =>
      new AIMessage({
        content: "",
        tool_calls: [{ id: randomUUID(), name: "discovery_searchIps", args, type: "tool_call" }],
      });
    const { input, port } = fixture([
      call({ query: ipQuery, placeSearch: "Singapore" }),
      call({ query: filtered }),
      answer([ipId]),
    ]);
    const ip = {
      id: ipId,
      creatorId: "owner",
      title: "A Singapore story",
      roomNumber: "42",
      summary: "Romance",
      coverUrl: null,
      matched: true,
      locationSource: "analysis",
      locations: [],
      eras: [],
      episode: { id: ipId, durationSeconds: 900 },
    };
    port.searchIps.mockImplementation(async (r) => ({
      requestId: r.requestId,
      queryId,
      query: r.query,
      nextCursor: null,
      items: [ip],
      selected: r.selectedIpId ? ip : null,
      matchedCount: 1,
      accessibleCount: 9,
      countScope: "accessible_ips_with_published_translation",
      mapScope: r.map,
      mapIpCount: 0,
      mapMatchedIpCount: 0,
      clusters: [],
      places: [{ id: placeId, kind: "story_setting", label: "Singapore", ipCount: 1 }],
      placeCount: 1,
      placesTruncated: false,
    }));
    const result = await runDiscoveryAgent({
      ...input,
      conversation: {
        current: { kind: "ips", query: ipQuery },
        messages: [
          { role: "user", content: "Singapore romance, 1980–2000, episodes up to 15 minutes" },
        ],
      },
      genres: [{ code: "romance", label: "Romance" }],
    });
    expect(result).toMatchObject({
      kind: "ips",
      query: { ...filtered, locale: "en-US" },
      cards: [ip],
    });
    expect(port.searchIps).toHaveBeenCalledTimes(3);
    expect(port.searchCreators).not.toHaveBeenCalled();
  });
  it("rejects reused tool call identities instead of accepting a previous search result", async () => {
    const first = search();
    const duplicate = new AIMessage({ content: "", tool_calls: first.tool_calls });
    const { input, port } = fixture([first, duplicate, answer()]);
    await expect(runDiscoveryAgent(input)).rejects.toThrow(
      "Duplicate or missing discovery tool call identity"
    );
    expect(port.searchCreators).toHaveBeenCalledTimes(1);
  });
});
