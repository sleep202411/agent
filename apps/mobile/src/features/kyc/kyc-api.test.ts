import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { confirmKyc, loadKycStatus, readKycReturn, startKyc } from "./kyc-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), postForm: vi.fn() } }));
const returnUrl = "https://fizzdragon.fizzspace.cn/zh-CN/kyc";
const identity = {
  userName: "Test",
  certNo: "0".repeat(18),
  userId: "actor",
  metaInfo: '{"device":"fixture"}',
  returnUrl,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("reads explicit verification requirements without caching", async () => {
  vi.mocked(api.get).mockResolvedValue({ needAuth: true, needRole: false });
  const s = signal();
  expect(await loadKycStatus(1, s)).toEqual({ needAuth: true, needRole: false });
  expect(api.get).toHaveBeenCalledWith("/user/needAuth", {
    signal: s,
    cache: "no-store",
    retry: false,
  });
});
it("does not treat missing requirement data as verified", async () => {
  vi.mocked(api.get).mockResolvedValue({});
  await expect(loadKycStatus(1, signal())).rejects.toThrow();
});
it("initializes once through the official form endpoint", async () => {
  vi.mocked(api.postForm).mockResolvedValue({
    certifyId: "attempt",
    certifyUrl: "https://verify.aliyun.com/flow",
  });
  const s = signal();
  expect((await startKyc(identity, 1, s)).certifyId).toBe("attempt");
  expect(api.postForm).toHaveBeenCalledWith("/user/certify/init/web", identity, {
    signal: s,
    retry: false,
  });
});
it.each(["http://provider.test", "https://user:password@provider.test", "javascript:alert(1)"])(
  "rejects unsafe provider URLs: %s",
  async (certifyUrl) => {
    vi.mocked(api.postForm).mockResolvedValue({ certifyId: "attempt", certifyUrl });
    await expect(startKyc(identity, 1, signal())).rejects.toThrow();
  }
);
it.each(["F", "P"])("keeps backend status %s unverified", async (status) => {
  vi.mocked(api.postForm).mockResolvedValue({ status });
  expect(await confirmKyc("attempt", 1, signal())).toBe(false);
});
it("requires an explicit passed backend result", async () => {
  vi.mocked(api.postForm).mockResolvedValueOnce({}).mockResolvedValueOnce({ status: "T" });
  await expect(confirmKyc("attempt", 1, signal())).rejects.toThrow();
  expect(await confirmKyc("attempt", 1, signal())).toBe(true);
});
it("does not dispatch stale or cancelled attempts", async () => {
  h.generation = 2;
  await expect(startKyc(identity, 1, signal())).rejects.toThrow("expired");
  const c = new AbortController();
  c.abort();
  await expect(confirmKyc("attempt", 2, c.signal)).rejects.toThrow();
  expect(api.postForm).not.toHaveBeenCalled();
});
it("rejects a result arriving under a replacement account", async () => {
  vi.mocked(api.postForm).mockImplementation(async () => {
    h.generation++;
    return { status: "T" };
  });
  await expect(confirmKyc("attempt", 1, signal())).rejects.toThrow("expired");
});
const callback = (id: string) =>
  returnUrl +
  "?response=" +
  encodeURIComponent(JSON.stringify({ code: "1000", extInfo: { certifyId: id } }));
it("accepts only the exact callback origin/path and current successful attempt", () => {
  expect(readKycReturn(callback("attempt"), returnUrl, "attempt")?.code).toBe("1000");
  expect(
    readKycReturn(callback("attempt").replace(".cn/", ".cn.evil.test/"), returnUrl, "attempt")
  ).toBeNull();
  expect(
    readKycReturn(callback("attempt").replace("/kyc?", "/other?"), returnUrl, "attempt")
  ).toBeNull();
  expect(() => readKycReturn(callback("foreign"), returnUrl, "attempt")).toThrow("current attempt");
});
it("preserves cancellation without interpreting it as success", () => {
  const url = returnUrl + "?response=" + encodeURIComponent(JSON.stringify({ code: "1003" }));
  expect(readKycReturn(url, returnUrl, "attempt")?.code).toBe("1003");
  expect(api.postForm).not.toHaveBeenCalled();
});
