import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchPricing,
  priceFields,
  parsePriceDate,
  priceDateText,
  pricingOutbox,
  savePricing,
  type PricingSnapshot,
  type PricingCommand,
} from "./pricing-api";
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
const episodeId = "44444444-4444-4444-8444-444444444444";
const fields = { amount: "100", originalAmount: "120", startsAt: null, endsAt: null };
const command: PricingCommand = {
  clientKey,
  expectedVersion: 1,
  episodeId,
  initialPreview: true,
  action: "price",
  data: fields,
};
let snapshot: PricingSnapshot;
const signal = () => new AbortController().signal;
function price(targetType: "ip" | "episode", data = fields) {
  return {
    id: nextKey,
    targetType,
    currency: "community_point" as const,
    campaignId: null,
    status: "active",
    ...data,
  };
}
function apply(path: string, data: Record<string, unknown>) {
  if (data.expectedVersion !== snapshot.version) throw Error("Version conflict");
  snapshot = {
    ...snapshot,
    version: snapshot.version + 1,
    episodes: snapshot.episodes.map((item) => ({ ...item })),
    priceRules: [...snapshot.priceRules],
  };
  if (path.endsWith("/price-rules")) {
    const target = data.targetType as "ip" | "episode";
    snapshot.priceRules = snapshot.priceRules.filter((item) => item.targetType !== target);
    const rule = data.status === "disabled" ? null : price(target, data as typeof fields);
    if (rule) snapshot.priceRules.push(rule);
    if (target === "ip") snapshot.price = rule;
    else snapshot.episodes[0].price = rule;
  } else snapshot.episodes[0].isFreePreview = data.isFreePreview as boolean;
  return { ip: snapshot };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  snapshot = {
    id,
    title: "Story",
    version: 1,
    price: null,
    priceRules: [],
    episodes: [
      { id: episodeId, title: "Episode", status: "published", isFreePreview: true, price: null },
    ],
  };
  h.get.mockImplementation(async () => ({ ip: snapshot }));
  h.put.mockImplementation(async (path, { data }) => apply(path, data));
});
it("validates integer prices without rounding and date windows", () => {
  expect(priceFields.parse({ ...fields, amount: "000100" }).amount).toBe("100");
  for (const data of [
    { ...fields, amount: "0" },
    { ...fields, amount: "1.5" },
    { ...fields, amount: "1e3" },
    { ...fields, amount: "9".repeat(19) },
    { ...fields, originalAmount: "99" },
    { ...fields, startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" },
  ])
    expect(priceFields.safeParse(data).success).toBe(false);
  expect(parsePriceDate("")).toBeNull();
  expect(() => parsePriceDate("2026-02-30 12:00")).toThrow();
  expect(() => parsePriceDate("2026-10-01 24:00")).toThrow();
  expect(priceDateText(parsePriceDate("2026-10-01 12:34"))).toBe("2026-10-01 12:34");
});
it("prices a free-preview episode with sequential shared versions and retains exact field scope", async () => {
  await savePricing(id, "alice", 1, command, signal());
  expect(h.put.mock.calls[0][1].data).toEqual({ isFreePreview: false, expectedVersion: 1 });
  expect(h.put.mock.calls[1][1].data).toEqual({
    ...fields,
    targetType: "episode",
    episodeId,
    status: "active",
    currency: "community_point",
    maxPerUser: null,
    expectedVersion: 2,
  });
  expect(snapshot.episodes[0].isFreePreview).toBe(false);
  expect(pricingOutbox(id, "alice", 1).read()).toBeNull();
});
it.each(["preview", "unpriced"] as const)(
  "disables a price before setting the %s flag",
  async (action) => {
    snapshot.episodes[0].isFreePreview = false;
    snapshot.episodes[0].price = price("episode");
    snapshot.priceRules = [price("episode")];
    await savePricing(
      id,
      "alice",
      1,
      { clientKey, expectedVersion: 1, episodeId, initialPreview: false, action },
      signal()
    );
    expect(h.put.mock.calls[0][1].data.status).toBe("disabled");
    expect(h.put.mock.calls[1][1].data).toEqual({
      expectedVersion: 2,
      isFreePreview: action === "preview",
    });
  }
);
it("resumes after a confirmed first step and a failed second step without repeating the first", async () => {
  h.put
    .mockImplementationOnce(async (path, { data }) => apply(path, data))
    .mockRejectedValueOnce(new Error("Offline"));
  await expect(savePricing(id, "alice", 1, command, signal())).rejects.toThrow("Offline");
  expect(pricingOutbox(id, "alice", 1).read()?.index).toBe(1);
  await savePricing(id, "alice", 1, command, signal());
  expect(h.put).toHaveBeenCalledTimes(3);
  expect(h.put.mock.calls[2][0]).toContain("/price-rules");
  expect(h.put.mock.calls[2][1].data.expectedVersion).toBe(2);
});
it("recovers a lost flag response at exactly the next version and continues pricing", async () => {
  h.put.mockImplementationOnce(async (path, { data }) => {
    apply(path, data);
    throw Error("Lost flag response");
  });
  await expect(savePricing(id, "alice", 1, command, signal())).rejects.toThrow();
  await savePricing(id, "alice", 1, command, signal());
  expect(h.put).toHaveBeenCalledTimes(2);
  expect(snapshot.version).toBe(3);
});
it("recovers a lost active episode price receipt without another price write", async () => {
  snapshot.episodes[0].isFreePreview = false;
  const input = { ...command, initialPreview: false };
  h.put.mockImplementationOnce(async (path, { data }) => {
    apply(path, data);
    throw Error("Lost price reply");
  });
  await expect(savePricing(id, "alice", 1, input, signal())).rejects.toThrow();
  await savePricing(id, "alice", 1, input, signal());
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("does not infer a scheduled episode save or disabled scheduled rule from missing active prices", async () => {
  snapshot.episodes[0].isFreePreview = false;
  const input = { ...command, initialPreview: false };
  h.put.mockImplementationOnce(async (path, { data }) => {
    apply(path, data);
    snapshot.episodes[0].price = null;
    throw Error("Lost reply");
  });
  await expect(savePricing(id, "alice", 1, input, signal())).rejects.toThrow();
  await expect(savePricing(id, "alice", 1, input, signal())).rejects.toThrow("review");
  expect(h.put).toHaveBeenCalledTimes(1);
  expect(pricingOutbox(id, "alice", 1).read()).not.toBeNull();
});
it("recovers scheduled bundle prices using a target-specific rule", async () => {
  const input: PricingCommand = {
    ...command,
    episodeId: null,
    initialPreview: false,
    data: { ...fields, startsAt: "2030-01-01T00:00:00Z" },
  };
  h.put.mockImplementationOnce(async (path, { data }) => {
    apply(path, data);
    snapshot.price = null;
    throw Error("Lost reply");
  });
  await expect(savePricing(id, "alice", 1, input, signal())).rejects.toThrow();
  await savePricing(id, "alice", 1, input, signal());
  expect(h.put).toHaveBeenCalledTimes(1);
});
it("never rebases on unrelated version changes or proceeds after another request replaces the checkpoint", async () => {
  snapshot.version = 3;
  await expect(savePricing(id, "alice", 1, command, signal())).rejects.toThrow("review");
  expect(h.put).not.toHaveBeenCalled();
  const box = pricingOutbox(id, "alice", 1);
  expect(() => box.start({ ...command, clientKey: nextKey })).toThrow();
  expect(() => box.clear(nextKey)).toThrow();
  expect(pricingOutbox(id, "bob", 1).read()).toBeNull();
  expect(pricingOutbox(nextKey, "alice", 1).read()).toBeNull();
});
it("keeps unknown receipts pending and enforces IP identity", async () => {
  h.put.mockResolvedValue({ ip: { ...snapshot, version: 9 } });
  await expect(savePricing(id, "alice", 1, command, signal())).rejects.toThrow("version");
  expect(pricingOutbox(id, "alice", 1).read()).not.toBeNull();
  h.get.mockResolvedValue({ ip: { ...snapshot, id: nextKey } });
  await expect(fetchPricing(id, 1, signal())).rejects.toThrow("identity");
});
it("guards network and durable records across authentication changes and cancellation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(savePricing(id, "alice", 1, command, c.signal)).rejects.toThrow();
  expect(h.put).not.toHaveBeenCalled();
  h.put.mockImplementationOnce(async (path, { data }) => {
    const result = apply(path, data);
    h.generation = 2;
    return result;
  });
  await expect(savePricing(id, "alice", 1, command, signal())).rejects.toThrow("expired");
  h.generation = 1;
  expect(pricingOutbox(id, "alice", 1).read()?.index).toBe(0);
});
