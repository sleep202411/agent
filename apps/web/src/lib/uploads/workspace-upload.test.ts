import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/src/lib/api", () => ({ backendApi: { post } }));
vi.mock("@/src/env", () => ({ env: { OSS_BASE_URL: "https://media.example/" } }));
import { uploadWorkspaceFile, uploadChatAttachment } from "./workspace-upload";
const file = () => new File(["brief"], "brief.txt", { type: "text/plain" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  post.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => vi.unstubAllGlobals());
describe("workspace upload ownership", () => {
  it("rejects an already abandoned upload before signing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadWorkspaceFile(file(), { uploadType: "WORLD", signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(post).not.toHaveBeenCalled();
  });
  it("does not start PUT when an abandoned signer returns late", async () => {
    const signing = deferred<{ url: string }>();
    post.mockReturnValue(signing.promise);
    const controller = new AbortController();
    const result = uploadWorkspaceFile(file(), { uploadType: "WORLD", signal: controller.signal });
    controller.abort();
    signing.resolve({ url: "https://media.example/brief.txt" });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves signing metadata without reading the whole file for an unused hash", async () => {
    post.mockResolvedValue({ url: "https://media.example/folder/brief.txt?signature=x" });
    const input = file();
    Object.defineProperty(input, "arrayBuffer", {
      value: vi.fn(() => {
        throw new Error("unnecessary read");
      }),
    });
    const controller = new AbortController();
    const result = await uploadWorkspaceFile(input, {
      uploadType: "WORLD",
      sourceType: "LOCAL",
      signal: controller.signal,
    });
    expect(result.name).toBe("brief.txt");
    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
        data: expect.objectContaining({
          extraParam: expect.objectContaining({ sourceType: "LOCAL" }),
        }),
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal, body: input })
    );
  });
  it("rejects late successful PUT results after cancellation", async () => {
    post.mockResolvedValue({ url: "https://media.example/brief.txt" });
    const response = deferred<{ ok: boolean }>();
    vi.mocked(fetch).mockReturnValue(response.promise as Promise<Response>);
    const controller = new AbortController();
    const result = uploadWorkspaceFile(file(), { uploadType: "WORLD", signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    response.resolve({ ok: true });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
  it("does not allow a caller to exceed the chat server size cap", async () => {
    const input = file();
    Object.defineProperty(input, "size", { value: 26 * 1024 * 1024 });
    await expect(uploadChatAttachment(input, { maxSize: 100 * 1024 * 1024 })).rejects.toThrow(
      "fileSizeExceedMb"
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects chat results cancelled during response reading", async () => {
    const body = deferred<object>();
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => body.promise } as Response);
    const controller = new AbortController();
    const result = uploadChatAttachment(file(), { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    body.resolve({ ref: "ref", filename: "brief.txt" });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
