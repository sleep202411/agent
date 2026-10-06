import { describe, expect, it, vi } from "vitest";
import type { ContentGpsSearchRequest } from "@repo/shared/content-gps";
import type { CreatorDiscoveryRequest } from "@repo/shared/creator-location";
import { executeDiscoveryTool, type DiscoveryToolHost } from "./discovery-tools.js";
const query = {
  schemaVersion: 1,
  location: null,
  era: null,
  duration: null,
  genreCodes: [],
  moodPreferences: [],
};
const creatorQuery = {
  basedIn: null,
  serves: null,
  remoteOnly: false,
  availableForWork: false,
  category: null,
  text: "",
};
const queryId = "a".repeat(64);
function fixture() {
  const port = {
    searchIps: vi.fn(async (r: ContentGpsSearchRequest) => ({
      requestId: r.requestId,
      queryId,
      query: r.query,
      nextCursor: null,
      items: [],
      selected: null,
      matchedCount: 0,
      accessibleCount: 0,
      countScope: "accessible_ips_with_published_translation",
      mapScope: r.map,
      mapIpCount: 0,
      mapMatchedIpCount: 0,
      clusters: [],
      places: [],
      placeCount: 0,
      placesTruncated: false,
    })),
    searchCreators: vi.fn(async (r: CreatorDiscoveryRequest) => ({
      requestId: r.requestId,
      queryId,
      query: r.query,
      nextCursor: null,
      items: [],
      selected: null,
      matchedCount: 0,
      accessibleCount: 0,
      requiresLogin: false,
      island: { creatorCount: 0, matchedCreatorCount: 0 },
      countScope: "public_platform_creators_with_listed_services",
      map: null,
    })),
  };
  const host: DiscoveryToolHost = { locale: "zh-CN", coordinateSystem: "GCJ02", port };
  return { host, port, signal: new AbortController().signal };
}
describe("discovery query execution", () => {
  it("injects trusted locale and request identity without returning map/internal payloads", async () => {
    const { host, port, signal } = fixture();
    const result = await executeDiscoveryTool("discovery.searchIps", { query }, host, signal);
    expect(port.searchIps).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { ...query, locale: "zh-CN" },
        selectedIpId: null,
        map: expect.objectContaining({ coordinateSystem: "GCJ02" }),
      }),
      signal
    );
    expect(result).toMatchObject({
      queryId,
      query: { ...query, locale: "zh-CN" },
      countScope: "accessible_ips_with_published_translation",
    });
    expect(result).not.toHaveProperty("mapScope");
    expect(result).not.toHaveProperty("requestId");
  });
  it.each(["actorId", "viewerId", "requestId", "selectedIpId", "map", "locale"])(
    "rejects model-provided %s before reading",
    async (field) => {
      const { host, port, signal } = fixture();
      await expect(
        executeDiscoveryTool("discovery.searchIps", { query, [field]: "forged" }, host, signal)
      ).rejects.toThrow();
      expect(port.searchIps).not.toHaveBeenCalled();
    }
  );
  it("rejects locale inside model criteria", async () => {
    const { host, port, signal } = fixture();
    await expect(
      executeDiscoveryTool(
        "discovery.searchIps",
        { query: { ...query, locale: "en-US" } },
        host,
        signal
      )
    ).rejects.toThrow();
    expect(port.searchIps).not.toHaveBeenCalled();
  });
  it("keeps creator queries separate and list-only", async () => {
    const { host, port, signal } = fixture();
    await executeDiscoveryTool("discovery.searchCreators", { query: creatorQuery }, host, signal);
    expect(port.searchCreators).toHaveBeenCalledWith(
      expect.objectContaining({ query: creatorQuery, map: null, selectedCreatorId: null }),
      signal
    );
    expect(port.searchIps).not.toHaveBeenCalled();
  });
  it.each(["characters.upsert", "contentGps.analyze", "discovery.unknown"])(
    "cannot execute %s",
    async (id) => {
      const { host, port, signal } = fixture();
      await expect(executeDiscoveryTool(id, {}, host, signal)).rejects.toThrow(
        "Unsupported discovery tool"
      );
      expect(port.searchIps).not.toHaveBeenCalled();
      expect(port.searchCreators).not.toHaveBeenCalled();
    }
  );
  it("rejects stale cursor identity", async () => {
    const { host, signal } = fixture();
    await expect(
      executeDiscoveryTool(
        "discovery.searchIps",
        {
          query,
          cursor: { queryId: "b".repeat(64), afterId: "11111111-1111-4111-8111-111111111111" },
        },
        host,
        signal
      )
    ).rejects.toThrow("does not match");
  });
  it("rejects response request substitution", async () => {
    const { host, port, signal } = fixture();
    const original = port.searchCreators.getMockImplementation()!;
    port.searchCreators.mockImplementation(async (r) => ({
      ...(await original(r)),
      requestId: "11111111-1111-4111-8111-111111111111",
    }));
    await expect(
      executeDiscoveryTool("discovery.searchCreators", { query: creatorQuery }, host, signal)
    ).rejects.toThrow("does not match");
  });
  it("settles cancellation even when the host ignores the signal", async () => {
    const { host, port } = fixture();
    const controller = new AbortController();
    port.searchCreators.mockImplementation(() => new Promise(() => {}));
    const result = executeDiscoveryTool(
      "discovery.searchCreators",
      { query: creatorQuery },
      host,
      controller.signal
    );
    await Promise.resolve();
    controller.abort(new Error("account changed"));
    await expect(result).rejects.toThrow("account changed");
  });
  it("does not invoke a cancelled read", async () => {
    const { host, port } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeDiscoveryTool("discovery.searchIps", { query }, host, controller.signal)
    ).rejects.toThrow();
    expect(port.searchIps).not.toHaveBeenCalled();
  });
});
