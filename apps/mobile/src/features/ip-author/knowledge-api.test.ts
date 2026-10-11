import { beforeEach, expect, it, vi } from "vitest";
import { fetchKnowledge, saveKnowledge } from "./knowledge-api";
const state = vi.hoisted(() => ({ generation: 1, get: vi.fn(), put: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("@/lib/api-client", () => ({ api: state }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const snapshot = {
  version: 5,
  documents: [
    { id, title: "Official synopsis", content: "Approved film background.", isPublished: false },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.generation = 1;
  state.get.mockResolvedValue(snapshot);
  state.put.mockResolvedValue({ ...snapshot, version: 6 });
});
it("loads editable materials from the authenticated Aurora endpoint", async () => {
  const signal = new AbortController().signal;
  await expect(fetchKnowledge(id, 1, signal)).resolves.toEqual(snapshot);
  expect(state.get).toHaveBeenCalledWith(`/ip-commerce/me/ips/${id}/knowledge-documents`, {
    service: "aurora",
    signal,
    retry: false,
  });
});
it("saves explicit publication status with optimistic concurrency and no automatic write retry", async () => {
  const signal = new AbortController().signal;
  await saveKnowledge(id, 1, snapshot, signal);
  expect(state.put).toHaveBeenCalledWith(`/ip-commerce/me/ips/${id}/knowledge-documents`, {
    service: "aurora",
    signal,
    retry: false,
    data: { documents: snapshot.documents, expectedVersion: 5 },
  });
});
it("blocks writes from an expired account session", async () => {
  state.generation = 2;
  await expect(saveKnowledge(id, 1, snapshot, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  expect(state.put).not.toHaveBeenCalled();
});
it("does not surface private material after the account changes during the request", async () => {
  state.get.mockImplementation(async () => {
    state.generation = 2;
    return snapshot;
  });
  await expect(fetchKnowledge(id, 1, new AbortController().signal)).rejects.toThrow("expired");
});
it("rejects blank content before sending a mutation", async () => {
  await expect(
    saveKnowledge(
      id,
      1,
      { ...snapshot, documents: [{ ...snapshot.documents[0], content: " " }] },
      new AbortController().signal
    )
  ).rejects.toThrow();
  expect(state.put).not.toHaveBeenCalled();
});
it("preserves a version conflict for explicit reload instead of silently overwriting", async () => {
  state.put.mockRejectedValue(Object.assign(new Error("Conflict"), { status: 409 }));
  await expect(saveKnowledge(id, 1, snapshot, new AbortController().signal)).rejects.toMatchObject({
    status: 409,
  });
  expect(state.put).toHaveBeenCalledTimes(1);
});
