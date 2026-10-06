import { describe, expect, it, vi } from "vitest";
import {
  DiscoveryAssistantRequestSchema,
  DiscoveryAssistantResultSchema,
} from "@repo/shared/discovery-assistant";
import type { CreatorDiscoveryRequest } from "@repo/shared/creator-location";
import { createDiscoveryQueryPort } from "./discovery-query-port.js";
const requestId = "11111111-1111-4111-8111-111111111111";
const readToken = "b".repeat(64);
const internalToken = "internal-secret-for-test";
const query = {
  basedIn: null,
  serves: null,
  remoteOnly: false,
  availableForWork: false,
  category: null,
  text: "",
};
const input: CreatorDiscoveryRequest = {
  requestId,
  query,
  limit: 10,
  cursor: null,
  selectedCreatorId: null,
  map: null,
};
const payload = {
  requestId,
  queryId: "a".repeat(64),
  query,
  items: [],
  selected: null,
  nextCursor: null,
  matchedCount: 0,
  accessibleCount: 1,
  requiresLogin: false,
  island: { creatorCount: 1, matchedCreatorCount: 0 },
  countScope: "public_platform_creators_with_listed_services",
  map: null,
};
function fixture(response = Response.json(payload)) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const port = createDiscoveryQueryPort({
    baseUrl: "http://127.0.0.1:4300",
    internalToken,
    credential: { requestId, readToken },
    fetcher,
  });
  return { port, fetcher, signal: new AbortController().signal };
}
describe("discovery scoped query transport", () => {
  it("uses the fixed private route and server credential, without cookies or redirects", async () => {
    const { port, fetcher, signal } = fixture();
    await expect(port.searchCreators(input, signal)).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:4300/internal/content-gps/discovery/read");
    expect(init).toMatchObject({
      redirect: "error",
      credentials: "omit",
      headers: { "x-agent-os-internal-token": internalToken },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      requestId,
      readToken,
      kind: "creators",
      input,
    });
  });
  it("does not send a pre-cancelled request", async () => {
    const { port, fetcher } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(port.searchCreators(input, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not retry a transport failure or disclose its URL/credentials", async () => {
    const { port, fetcher, signal } = fixture();
    fetcher.mockRejectedValue(new Error(`failed ${internalToken} ${readToken}`));
    await expect(port.searchCreators(input, signal)).rejects.toThrow(
      "Discovery catalogue transport failed"
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps useful upstream rejection messages while redacting secrets", async () => {
    const { port, signal } = fixture(
      Response.json({ message: `Expired ${readToken} ${internalToken}` }, { status: 403 })
    );
    await expect(port.searchCreators(input, signal)).rejects.toThrow(
      "Expired [redacted] [redacted]"
    );
  });
  it("rejects an HTTP-200 error envelope", async () => {
    const { port, signal } = fixture(Response.json({ code: 403, msg: "denied", data: payload }));
    await expect(port.searchCreators(input, signal)).rejects.toThrow();
  });
  it("bounds streamed response bytes", async () => {
    const { port, signal } = fixture(new Response("x".repeat(3 * 1024 * 1024 + 1)));
    await expect(port.searchCreators(input, signal)).rejects.toThrow("too large");
  });
  it("rejects malformed JSON without reflecting raw response text", async () => {
    const { port, signal } = fixture(new Response(internalToken));
    await expect(port.searchCreators(input, signal)).rejects.toThrow(
      "Invalid discovery catalogue response"
    );
  });
  it.each([
    "file:///tmp/catalogue",
    "https://user:secret@example.com",
    "https://example.com/?token=x",
  ])("rejects unsafe domain configuration %s", (baseUrl) => {
    expect(() =>
      createDiscoveryQueryPort({ baseUrl, internalToken, credential: { requestId, readToken } })
    ).toThrow();
  });
});
describe("discovery public contract", () => {
  it("does not accept read credentials or viewer IDs from a browser request", () => {
    const body = {
      requestId,
      locale: "en-US",
      conversation: {
        current: { kind: "creators", query },
        messages: [{ role: "user", content: "Find a studio" }],
      },
    };
    expect(DiscoveryAssistantRequestSchema.safeParse(body).success).toBe(true);
    for (const extra of [
      { readToken },
      { actorId: "another" },
      { credential: { requestId, readToken } },
    ])
      expect(DiscoveryAssistantRequestSchema.safeParse({ ...body, ...extra }).success).toBe(false);
  });
  it("rejects fabricated counts or empty recommendations when matches exist", () => {
    const result = {
      status: "results",
      kind: "creators",
      query,
      queryId: "a".repeat(64),
      cards: [],
      matchedCount: 0,
      accessibleCount: 4,
      countScope: "public_platform_creators_with_listed_services",
      requiresLogin: false,
    };
    expect(DiscoveryAssistantResultSchema.safeParse(result).success).toBe(true);
    expect(DiscoveryAssistantResultSchema.safeParse({ ...result, matchedCount: 1 }).success).toBe(
      false
    );
    expect(DiscoveryAssistantResultSchema.safeParse({ ...result, matchedCount: 5 }).success).toBe(
      false
    );
    expect(DiscoveryAssistantResultSchema.safeParse({ ...result, readToken }).success).toBe(false);
  });
});
