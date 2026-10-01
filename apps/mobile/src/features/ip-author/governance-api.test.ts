import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchGovernance,
  governanceCommand,
  governanceOutbox,
  releaseLinks,
  saveGovernance,
  type GovernanceCommand,
} from "./governance-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put },
  ApiRequestError: class extends Error {
    constructor(
      _code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  clientKey = "22222222-2222-4222-8222-222222222222",
  nextKey = "33333333-3333-4333-8333-333333333333";
const old = {
  copyrightOwner: "Original holder",
  rightsSummary: { statement: "Original rights" },
  aiDisclosure: { generatedVisuals: false, generatedCopy: false, statement: "" },
};
const disclosure: GovernanceCommand = {
  kind: "disclosures",
  clientKey,
  expectedVersion: 1,
  data: {
    copyrightOwner: "New holder",
    rightsSummary: { statement: "Licensed adaptation" },
    aiDisclosure: {
      generatedVisuals: true,
      generatedCopy: false,
      statement: "Generated backgrounds",
    },
  },
};
const links: GovernanceCommand = {
  kind: "links",
  clientKey,
  expectedVersion: 1,
  data: { links: [{ label: "Watch", url: "https://example.com/watch" }] },
};
const crew: GovernanceCommand = {
  kind: "crew",
  clientKey,
  expectedVersion: 1,
  data: { crewId: "crew-a" },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("release-links")
      ? { links: [], version: 1 }
      : path.endsWith("/crew")
        ? { crewId: null, version: 1, choices: [{ id: "crew-a", name: "Crew A" }] }
        : { ip: { id, title: "Story", version: 1, ...old } }
  );
  h.put.mockImplementation(async (path: string, { data }) =>
    path.endsWith("release-links")
      ? { links: data.links, version: 2 }
      : path.endsWith("/crew")
        ? { crewId: data.crewId, version: 2, choices: [{ id: "crew-a", name: "Crew A" }] }
        : { ip: { id, title: "Story", version: 2, ...data } }
  );
});
it("reads legacy empty disclosures without inventing AI use, and checks IP identity", async () => {
  h.get.mockResolvedValue({
    ip: { id, title: "Story", version: 1, rightsSummary: {}, aiDisclosure: null },
  });
  const result = await fetchGovernance(id, 1, "disclosures", signal());
  expect(result.data).toEqual({
    copyrightOwner: null,
    rightsSummary: { statement: "" },
    aiDisclosure: { generatedVisuals: false, generatedCopy: false, statement: "" },
  });
  h.get.mockResolvedValue({ ip: { id: clientKey, title: "Wrong", version: 1 } });
  await expect(fetchGovernance(id, 1, "disclosures", signal())).rejects.toThrow("identity");
});
it.each([
  "http://example.com",
  "javascript:alert(1)",
  "https://name:secret@example.com",
  "file:///tmp/file",
  "//example.com",
])("rejects unsafe release URL %s", (url) => {
  expect(releaseLinks.safeParse([{ label: "Link", url }]).success).toBe(false);
});
it("validates link labels, duplicate URLs and the official 20-link cap", () => {
  expect(releaseLinks.parse([{ label: " Watch ", url: " https://example.com " }])).toEqual([
    { label: "Watch", url: "https://example.com" },
  ]);
  expect(releaseLinks.safeParse([{ label: "", url: "https://example.com" }]).success).toBe(false);
  expect(releaseLinks.safeParse([...links.data.links, ...links.data.links]).success).toBe(false);
  expect(
    releaseLinks.safeParse(
      Array.from({ length: 21 }, (_, i) => ({ label: "Watch", url: `https://example.com/${i}` }))
    ).success
  ).toBe(false);
});
it("allows incomplete rights drafts but enforces official length limits", () => {
  expect(governanceCommand.safeParse({ ...disclosure, data: old }).success).toBe(true);
  expect(
    governanceCommand.safeParse({
      ...disclosure,
      data: { ...old, copyrightOwner: "x".repeat(161) },
    }).success
  ).toBe(false);
  expect(
    governanceCommand.safeParse({
      ...disclosure,
      data: { ...old, rightsSummary: { statement: "x".repeat(1001) } },
    }).success
  ).toBe(false);
});
it.each([disclosure, links, crew])(
  "sends only $kind fields and the original IP version",
  async (command) => {
    await saveGovernance(id, 1, command, signal());
    expect(h.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ retry: false, data: { ...command.data, expectedVersion: 1 } })
    );
    expect(h.put.mock.calls[0][1].data).not.toHaveProperty("title");
    expect(h.put.mock.calls[0][1].data).not.toHaveProperty("clientKey");
  }
);
it.each([disclosure, links, crew])(
  "recovers matching $kind values after a lost receipt without another PUT",
  async (command) => {
    h.get.mockResolvedValue(
      command.kind === "disclosures"
        ? { ip: { id, title: "Story", version: 2, ...command.data } }
        : { version: 2, ...command.data, choices: [] }
    );
    expect((await saveGovernance(id, 1, command, signal())).version).toBe(2);
    expect(h.put).not.toHaveBeenCalled();
  }
);
it("does not overwrite a concurrent rights edit or attach the newest version to a stale command", async () => {
  h.get.mockResolvedValue({ ip: { id, title: "Story", version: 2, ...old } });
  await expect(saveGovernance(id, 1, disclosure, signal())).rejects.toThrow("changed");
  expect(h.put).not.toHaveBeenCalled();
});
it("checks current Crew production permission but can unlink an unavailable existing Crew", async () => {
  h.get.mockResolvedValue({ version: 1, crewId: "legacy-crew", choices: [] });
  const result = await fetchGovernance(id, 1, "crew", signal());
  expect(result.data).toEqual({ crewId: "legacy-crew" });
  await expect(saveGovernance(id, 1, crew, signal())).rejects.toThrow("manage production");
  expect(h.put).not.toHaveBeenCalled();
  await saveGovernance(id, 1, { ...crew, data: { crewId: null } }, signal());
  expect(h.put).toHaveBeenCalledWith(
    expect.stringContaining("/crew"),
    expect.objectContaining({ data: { crewId: null, expectedVersion: 1 } })
  );
});
it("rejects duplicate Crew choices and incorrect write receipts", async () => {
  h.get.mockResolvedValueOnce({
    version: 1,
    crewId: null,
    choices: [
      { id: "x", name: "X" },
      { id: "x", name: "X" },
    ],
  });
  await expect(fetchGovernance(id, 1, "crew", signal())).rejects.toThrow("Duplicate");
  h.put.mockResolvedValue({ links: [], version: 2 });
  await expect(saveGovernance(id, 1, links, signal())).rejects.toThrow("receipt");
  h.put.mockResolvedValue({ links: links.data.links, version: 1 });
  await expect(saveGovernance(id, 1, links, signal())).rejects.toThrow("receipt");
});
it("keeps pending commands immutable and isolated by account, IP and form", () => {
  const outbox = governanceOutbox(id, "alice", 1, "disclosures");
  outbox.save(disclosure);
  expect(() => outbox.save({ ...disclosure, expectedVersion: 2 })).toThrow("pending");
  expect(governanceOutbox(id, "bob", 1, "disclosures").read()).toBeNull();
  expect(governanceOutbox(clientKey, "alice", 1, "disclosures").read()).toBeNull();
  expect(governanceOutbox(id, "alice", 1, "links").read()).toBeNull();
  expect(() => outbox.save(links)).toThrow("mismatch");
});
it("rebases only the same reviewed intent to a newer version in one record write", () => {
  const outbox = governanceOutbox(id, "alice", 1, "disclosures");
  outbox.save(disclosure);
  const replacement = { ...disclosure, clientKey: nextKey, expectedVersion: 2 };
  expect(() => outbox.rebase(replacement, nextKey)).toThrow("changed");
  expect(() => outbox.rebase({ ...replacement, data: old }, clientKey)).toThrow("changed");
  expect(() => outbox.rebase({ ...replacement, expectedVersion: 1 }, clientKey)).toThrow("changed");
  outbox.rebase(replacement, clientKey);
  expect(outbox.read()).toEqual(replacement);
  expect(() => outbox.clear(clientKey)).toThrow("pending");
  expect(outbox.read()).toEqual(replacement);
});
it("blocks aborted or expired editing sessions before further network or storage changes", async () => {
  const c = new AbortController();
  c.abort();
  await expect(saveGovernance(id, 1, disclosure, c.signal)).rejects.toThrow("expired");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { ip: { id, title: "Story", version: 1, ...old } };
  });
  await expect(saveGovernance(id, 1, disclosure, signal())).rejects.toThrow("expired");
  expect(h.put).not.toHaveBeenCalled();
  expect(() => governanceOutbox(id, "alice", 1, "disclosures").save(disclosure)).toThrow("expired");
});
