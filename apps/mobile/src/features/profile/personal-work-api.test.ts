import { expect, it, vi } from "vitest";
import { getPersonalWorkLink } from "./personal-work-api";
import { api } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ api: { postForm: vi.fn() } }));
it("resolves a fresh signed URL through Web's permission-checked form contract", async () => {
  vi.mocked(api.postForm).mockResolvedValue("https://media.test/video?signature=abc");
  const signal = new AbortController().signal;
  expect(await getPersonalWorkLink("12", signal)).toBe("https://media.test/video?signature=abc");
  expect(api.postForm).toHaveBeenLastCalledWith(
    "/vedio/play/personal/getLink",
    { id: "12" },
    { service: "content", signal }
  );
});
it.each([
  null,
  {},
  "",
  "private/bucket/key",
  "javascript:alert(1)",
  "https://user:password@media.test/file",
])("rejects invalid media instead of constructing private bucket URLs: %j", async (response) => {
  vi.mocked(api.postForm).mockResolvedValue(response);
  await expect(getPersonalWorkLink("12")).rejects.toThrow();
});
it("propagates access errors without falling back to private storage", async () => {
  vi.mocked(api.postForm).mockRejectedValueOnce(new Error("Forbidden"));
  await expect(getPersonalWorkLink("12")).rejects.toThrow("Forbidden");
});
