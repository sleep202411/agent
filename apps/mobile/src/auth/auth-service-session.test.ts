import { beforeEach, expect, it, vi } from "vitest";
import { loginWithPassword } from "./auth-service";
const api = vi.hoisted(() => ({ postForm: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api,
  ApiRequestError: class extends Error {
    constructor(public status: number) {
      super("Unauthorized");
    }
  },
}));
vi.mock("./send-auth-code", () => ({ sendAuthCode: vi.fn() }));
vi.mock("@/config", () => ({
  appEnv: {
    appRegion: "global",
    assets: { userBaseUrl: "", ossBaseUrl: "", bannerBaseUrl: "", staticBaseUrl: "" },
  },
  resolveAssetUrl: (path: string) => path,
}));
beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = "satoken=; Max-Age=0; Path=/";
  api.postForm.mockResolvedValue({
    code: 200,
    data: { tokenName: "satoken", tokenValue: "new", user: { id: "alice" } },
  });
  api.get.mockResolvedValue({ code: 200, info: { id: "alice" } });
});
it("returns login evidence without publishing an unaccepted browser cookie", async () => {
  const session = await loginWithPassword(
    { kind: "email", account: "alice@example.com" },
    "password"
  );
  expect(session.token?.tokenValue).toBe("new");
  expect(document.cookie).not.toContain("satoken=");
});
it("rejects an explicitly unauthorized profile even when login supplied a fallback user", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  // The mocked constructor takes the response status; production receives the same status field.
  api.get.mockRejectedValue(new (ApiRequestError as unknown as new (status: number) => Error)(401));
  await expect(
    loginWithPassword({ kind: "email", account: "alice@example.com" }, "password")
  ).rejects.toThrow("Unauthorized");
});
it("retains the existing fallback user on a transient profile-read failure", async () => {
  api.get.mockRejectedValue(new Error("Network unavailable"));
  await expect(
    loginWithPassword({ kind: "email", account: "alice@example.com" }, "password")
  ).resolves.toMatchObject({ user: { id: "alice" } });
});
