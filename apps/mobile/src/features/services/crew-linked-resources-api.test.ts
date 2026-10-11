import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchCrewIpLinkAccess,
  fetchLinkedFilms,
  fetchLinkedIps,
  fetchLinkedWorkspace,
} from "./crew-linked-resources-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const ws = "00000000-0000-4000-8000-000000000001";
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("reads linked IPs without requesting private workspace data", async () => {
  h.get.mockResolvedValue({ items: [{ id: "ip" }] });
  expect(await fetchLinkedIps("crew", 1, signal())).toEqual([{ id: "ip" }]);
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/crews/crew/ips",
    expect.objectContaining({ retry: false, service: "aurora" })
  );
});
it("verifies the Crew identity of the linked workspace", async () => {
  h.get.mockResolvedValue({
    page: { crewId: "crew" },
    studioWorkspace: { id: ws, name: "Studio" },
    capabilities: { linkWorkspace: true },
  });
  expect((await fetchLinkedWorkspace("crew", 1, signal())).workspace?.id).toBe(ws);
  h.get.mockResolvedValue({
    page: { crewId: "other" },
    studioWorkspace: null,
    capabilities: { linkWorkspace: false },
  });
  await expect(fetchLinkedWorkspace("crew", 1, signal())).rejects.toThrow("scope");
});
it("filters linked films by BOTH workspace and IP", async () => {
  h.get.mockResolvedValue({ items: [{ id: "film", title: "Film" }], nextCursor: null });
  await fetchLinkedFilms(ws, "ip", "cursor", 1, signal());
  expect(h.get).toHaveBeenCalledWith(
    "/story-projects",
    expect.objectContaining({
      params: { workspaceId: ws, linkedIpId: "ip", limit: 30, cursor: "cursor" },
      retry: false,
    })
  );
});
it.each([
  { items: [], nextCursor: "cursor" },
  {
    items: [
      { id: "a", title: "A" },
      { id: "a", title: "A" },
    ],
    nextCursor: null,
  },
  { items: [{ id: "../bad", title: "A" }], nextCursor: null },
])("rejects malformed or looping film pages %j", async (page) => {
  h.get.mockResolvedValue(page);
  await expect(fetchLinkedFilms(ws, "ip", "cursor", 1, signal())).rejects.toThrow();
});
it("rejects duplicate IPs and unsafe request IDs", async () => {
  h.get.mockResolvedValue({ items: [{ id: "a" }, { id: "a" }] });
  await expect(fetchLinkedIps("crew", 1, signal())).rejects.toThrow("Duplicate");
  h.get.mockClear();
  await expect(fetchLinkedIps("../bad", 1, signal())).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects cancelled or foreign account responses", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchLinkedIps("crew", 1, c.signal)).rejects.toThrow("expired");
  h.get.mockImplementation(async () => {
    h.generation++;
    return { items: [] };
  });
  await expect(fetchLinkedIps("crew", 1, signal())).rejects.toThrow("expired");
});

it("offers IP linking only to this account's production manager", async () => {
  h.get.mockResolvedValue({ userId: "actor", permissions: ["tasks.manage"] });
  expect(await fetchCrewIpLinkAccess("crew", "actor", 1, signal())).toBe(false);
  h.get.mockResolvedValue({ userId: "actor", permissions: ["production.manage"] });
  expect(await fetchCrewIpLinkAccess("crew", "actor", 1, signal())).toBe(true);
  await expect(fetchCrewIpLinkAccess("crew", "other", 1, signal())).rejects.toThrow(
    "account mismatch"
  );
});
it("rejects IP-link access from an expired session", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { userId: "actor", permissions: ["production.manage"] };
  });
  await expect(fetchCrewIpLinkAccess("crew", "actor", 1, signal())).rejects.toThrow(
    "session expired"
  );
});
it("retains the official capability when no workspace is linked", async () => {
  h.get.mockResolvedValue({
    page: { crewId: "crew" },
    studioWorkspace: null,
    capabilities: { linkWorkspace: true },
  });
  expect(await fetchLinkedWorkspace("crew", 1, signal())).toEqual({
    workspace: null,
    canLink: true,
  });
  h.get.mockResolvedValue({ page: { crewId: "crew" }, studioWorkspace: null });
  await expect(fetchLinkedWorkspace("crew", 1, signal())).rejects.toThrow();
});
