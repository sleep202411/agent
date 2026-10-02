import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./api-client";
import { confirmMobileMediaUpload, uploadMobileMediaFile } from "./media-upload";
vi.mock("./api-client", () => ({ api: { post: vi.fn() } }));
const auth = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => auth.generation }));
const fetchMock = vi.fn();
const file = { uri: "file:///local.pdf", name: "local.pdf", type: "application/pdf", size: 999 };
const signed = {
  uploadUrl: "https://storage.example/signed",
  method: "PUT",
  headers: { "x-storage-header": "required" },
  storageKey: "issued-key",
};
beforeEach(() => {
  vi.resetAllMocks();
  auth.generation = 1;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["1234"], { type: "application/pdf" }),
    })
    .mockResolvedValueOnce({ ok: true });
  vi.mocked(api.post)
    .mockResolvedValueOnce(signed)
    .mockResolvedValueOnce({ mediaAssetId: "media", url: "https://cdn.example/file" });
});
afterEach(() => vi.unstubAllGlobals());
it("signs actual bytes and echoes Crew scope through confirmation without leaking auth into storage", async () => {
  const signal = new AbortController().signal;
  await expect(
    uploadMobileMediaFile(file, { kind: "crew_asset_file", scope: { crewId: " crew " }, signal })
  ).resolves.toEqual({ mediaAssetId: "media", url: "https://cdn.example/file" });
  expect(api.post).toHaveBeenNthCalledWith(1, "/media/upload-url", {
    service: "aurora",
    signal,
    data: {
      kind: "crew_asset_file",
      contentType: "application/pdf",
      fileName: "local.pdf",
      sizeBytes: 4,
      scope: { crewId: "crew" },
    },
  });
  expect(api.post).toHaveBeenNthCalledWith(2, "/media/confirm", {
    service: "aurora",
    signal,
    data: {
      kind: "crew_asset_file",
      contentType: "application/pdf",
      storageKey: "issued-key",
      scope: { crewId: "crew" },
    },
  });
  expect(fetchMock).toHaveBeenNthCalledWith(1, file.uri, { signal });
  expect(fetchMock).toHaveBeenNthCalledWith(2, signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf", ...signed.headers },
    body: expect.any(Blob),
    signal,
  });
});
it("supports an omitted picker size and MIME without inventing an image type", async () => {
  await uploadMobileMediaFile(
    { ...file, type: "", size: undefined },
    { kind: "ai_reference_image" }
  );
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toMatchObject({
    sizeBytes: 4,
    contentType: "application/pdf",
  });
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).not.toHaveProperty("scope");
});
it("rejects missing Crew scope before reserving storage", async () => {
  await expect(uploadMobileMediaFile(file, { kind: "crew_asset_file" })).rejects.toThrow("scope");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["unreadable", "empty"])("does not sign an %s local file", async (mode) => {
  fetchMock
    .mockReset()
    .mockResolvedValue({ ok: mode !== "unreadable", status: 404, blob: async () => new Blob([]) });
  await expect(uploadMobileMediaFile(file, { kind: "ai_reference_image" })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("does not confirm a failed storage PUT", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["data"]) })
    .mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(uploadMobileMediaFile(file, { kind: "ai_reference_image" })).rejects.toThrow("503");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("stops after local reading if cancellation happened during blob resolution", async () => {
  const controller = new AbortController();
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    blob: async () => {
      controller.abort();
      return new Blob(["data"]);
    },
  });
  await expect(
    uploadMobileMediaFile(file, { kind: "ai_reference_image", signal: controller.signal })
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});

it("rejects actual oversized bytes before reserving storage", async () => {
  await expect(
    uploadMobileMediaFile(file, { kind: "crew_asset_file", scope: { crewId: "crew" }, maxBytes: 3 })
  ).rejects.toThrow("allowed upload size");
  expect(api.post).not.toHaveBeenCalled();
});

it("persists confirmation after PUT and before the confirmation request", async () => {
  const beforeConfirm = vi.fn(() => {
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  await uploadMobileMediaFile(file, {
    kind: "crew_asset_file",
    scope: { crewId: "crew" },
    beforeConfirm,
  });
  expect(beforeConfirm).toHaveBeenCalledWith({
    storageKey: "issued-key",
    kind: "crew_asset_file",
    contentType: "application/pdf",
    scope: { crewId: "crew" },
  });
});
it("does not confirm if saving recovery data fails", async () => {
  await expect(
    uploadMobileMediaFile(file, {
      kind: "crew_asset_file",
      scope: { crewId: "crew" },
      beforeConfirm: () => {
        throw new Error("Disk full");
      },
    })
  ).rejects.toThrow("Disk full");
  expect(api.post).toHaveBeenLastCalledWith(
    "/media/cancel-upload",
    expect.objectContaining({ timeout: 10000 })
  );
});

it("releases the original Crew reservation after an aborted PUT using independent cancellation", async () => {
  const controller = new AbortController();
  fetchMock
    .mockReset()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["data"]) })
    .mockImplementationOnce(() => {
      controller.abort();
      throw new Error("Upload interrupted");
    });
  await expect(
    uploadMobileMediaFile(file, {
      kind: "crew_asset_file",
      scope: { crewId: "crew" },
      signal: controller.signal,
    })
  ).rejects.toThrow("Upload interrupted");
  expect(api.post).toHaveBeenLastCalledWith("/media/cancel-upload", {
    service: "aurora",
    timeout: 10000,
    data: {
      storageKey: "issued-key",
      kind: "crew_asset_file",
      contentType: "application/pdf",
      scope: { crewId: "crew" },
    },
  });
});
it("preserves the upload failure when reservation cleanup also fails", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["data"]) })
    .mockRejectedValueOnce(new Error("Storage offline"));
  vi.mocked(api.post)
    .mockReset()
    .mockResolvedValueOnce(signed)
    .mockRejectedValueOnce(new Error("Cleanup offline"));
  await expect(
    uploadMobileMediaFile(file, { kind: "crew_asset_file", scope: { crewId: "crew" } })
  ).rejects.toThrow("Storage offline");
});
it("retains a saved confirmation checkpoint after confirmation response loss", async () => {
  vi.mocked(api.post)
    .mockReset()
    .mockResolvedValueOnce(signed)
    .mockRejectedValueOnce(new Error("Response lost"));
  await expect(
    uploadMobileMediaFile(file, {
      kind: "crew_asset_file",
      scope: { crewId: "crew" },
      beforeConfirm: vi.fn(),
    })
  ).rejects.toThrow("Response lost");
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post).toHaveBeenLastCalledWith("/media/confirm", expect.anything());
});
it("does not use a new account to cancel the previous account upload", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["data"]) })
    .mockImplementationOnce(() => {
      auth.generation = 2;
      throw new Error("Account changed");
    });
  await expect(
    uploadMobileMediaFile(file, { kind: "crew_asset_file", scope: { crewId: "crew" } })
  ).rejects.toThrow("Account changed");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("does not reserve storage after the account changes during local file reading", async () => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    blob: async () => {
      auth.generation = 2;
      return new Blob(["data"]);
    },
  });
  await expect(uploadMobileMediaFile(file, { kind: "agent_attachment_document" })).rejects.toThrow(
    "account changed"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("does not PUT or confirm after the signing account changes", async () => {
  vi.mocked(api.post)
    .mockReset()
    .mockImplementationOnce(async () => {
      auth.generation = 2;
      return signed;
    });
  await expect(uploadMobileMediaFile(file, { kind: "agent_attachment_document" })).rejects.toThrow(
    "account changed"
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("does not confirm under a new account after a successful storage PUT", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["data"]) })
    .mockImplementationOnce(async () => {
      auth.generation = 2;
      return { ok: true };
    });
  await expect(uploadMobileMediaFile(file, { kind: "agent_attachment_document" })).rejects.toThrow(
    "account changed"
  );
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("rejects a confirmation receipt after an account switch", async () => {
  vi.mocked(api.post)
    .mockReset()
    .mockResolvedValueOnce(signed)
    .mockImplementationOnce(async () => {
      auth.generation = 2;
      return { mediaAssetId: "media", url: "https://cdn.example/file" };
    });
  await expect(uploadMobileMediaFile(file, { kind: "agent_attachment_document" })).rejects.toThrow(
    "account changed"
  );
});

it("preserves Story project scope when signing and confirming", async () => {
  const scope = { storyProjectId: "00000000-0000-4000-8000-000000000001" };
  await uploadMobileMediaFile(
    { ...file, type: "image/png" },
    { kind: "ai_reference_image", scope }
  );
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toMatchObject({ scope });
  expect(vi.mocked(api.post).mock.calls[1][1]?.data).toMatchObject({ scope });
});
it.each([
  { crewId: "crew", storyProjectId: "00000000-0000-4000-8000-000000000001" },
  { storyProjectId: "not-a-project" },
  {},
])("rejects invalid or ambiguous upload scope before reading bytes", async (scope) => {
  await expect(uploadMobileMediaFile(file, { kind: "ai_reference_image", scope })).rejects.toThrow(
    "scope"
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects an unsupported upload kind before file access or transport", async () => {
  // Exercise untyped callers and stale persisted data against the server's shared enum.
  await expect(
    uploadMobileMediaFile(file, { kind: "ip_audience_reference" as never })
  ).rejects.toThrow();
  await expect(
    confirmMobileMediaUpload({
      storageKey: "old",
      contentType: "image/png",
      kind: "ip_audience_reference" as never,
    })
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
