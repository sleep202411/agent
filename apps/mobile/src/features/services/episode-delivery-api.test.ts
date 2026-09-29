import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchEpisodeDelivery,
  fetchEpisodeVideo,
  submitEpisodeDelivery,
  reviewEpisodeDelivery,
} from "./episode-delivery-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111",
  node = "22222222-2222-4222-8222-222222222222";
const delivery = {
  id: node,
  episodeId: id,
  versionNumber: 1,
  assetNodeId: node,
  status: "submitted" as const,
  note: "note",
  reviewNote: "",
  submittedByUserId: "user",
  reviewedByUserId: null,
  reviewedAt: null,
  createdAt: "2026-09-29T00:00:00Z",
  asset: {
    name: "video",
    kind: "video",
    contentType: "video/mp4",
    sizeBytes: 5,
    durationSeconds: 10,
  },
};
const episode = {
  id,
  crewId: "crew",
  version: 1,
  number: 1,
  title: "Pilot",
  synopsis: "",
  status: "in_review",
  durationSeconds: null,
  plannedReleaseAt: null,
  taskProgress: { total: 1, completed: 0, pendingReview: 1 },
  deliveries: [delivery],
};
const signal = new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("keeps deliver/review permissions independent from manage", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce([episode])
    .mockResolvedValueOnce({ userId: "user", permissions: ["production.deliver"] });
  expect(await fetchEpisodeDelivery("crew", id, "user", signal)).toMatchObject({
    canSubmit: true,
    canReview: false,
    episode,
  });
});
it.each([
  { rows: [{ ...episode, crewId: "foreign" }] },
  { rows: [episode, episode] },
  { rows: [{ ...episode, deliveries: [{ ...delivery, episodeId: node }] }] },
  { rows: [{ ...episode, deliveries: [delivery, delivery] }] },
  { rows: [] },
])("rejects mismatched episode histories", async ({ rows }) => {
  vi.mocked(api.get)
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce({ userId: "user", permissions: [] });
  await expect(fetchEpisodeDelivery("crew", id, "user", signal)).rejects.toThrow();
});
it("rejects another account's membership", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce([episode])
    .mockResolvedValueOnce({ userId: "other", permissions: ["production.review"] });
  await expect(fetchEpisodeDelivery("crew", id, "user", signal)).rejects.toThrow("scope mismatch");
});
it("submits a selected video node and trimmed note", async () => {
  vi.mocked(api.post).mockResolvedValue(delivery);
  await submitEpisodeDelivery(id, node, " note ", "user", 1);
  expect(api.post).toHaveBeenCalledWith(`/crew-episodes/${id}/deliveries`, {
    service: "aurora",
    data: { assetNodeId: node, note: "note" },
  });
});
it.each([
  { episodeId: node },
  { assetNodeId: id },
  { submittedByUserId: "other" },
  { status: "approved" },
  { note: "other" },
])("rejects wrong submission receipts", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...delivery, ...patch });
  await expect(submitEpisodeDelivery(id, node, "note", "user", 1)).rejects.toThrow(
    "response mismatch"
  );
});
it("refuses expired sessions before writes", async () => {
  h.generation = 2;
  await expect(submitEpisodeDelivery(id, node, "note", "user", 1)).rejects.toThrow(
    "session expired"
  );
  await expect(reviewEpisodeDelivery(delivery, "approve", "", "user", 1)).rejects.toThrow(
    "session expired"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects missing revision notes and settled versions without writing", async () => {
  await expect(reviewEpisodeDelivery(delivery, "reject", "  ", "user", 1)).rejects.toThrow();
  await expect(
    reviewEpisodeDelivery({ ...delivery, status: "approved" }, "approve", "", "user", 1)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["approve", "reject"] as const)(
  "reviews the selected immutable version: %s",
  async (decision) => {
    vi.mocked(api.post).mockResolvedValue({
      ...delivery,
      status: decision === "approve" ? "approved" : "rejected",
      reviewNote: "fix",
      reviewedByUserId: "user",
      reviewedAt: "2026-09-29T01:00:00Z",
    });
    await reviewEpisodeDelivery(delivery, decision, " fix ", "user", 1);
    expect(api.post).toHaveBeenCalledWith(`/crew-episode-deliveries/${node}/review`, {
      service: "aurora",
      data: { decision, note: "fix" },
    });
  }
);
it.each([
  { versionNumber: 2 },
  { assetNodeId: id },
  { reviewedByUserId: "other" },
  { reviewedAt: null },
  { status: "submitted" },
])("rejects incorrect review receipts", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({
    ...delivery,
    status: "approved",
    reviewedByUserId: "user",
    reviewedAt: "2026-09-29T01:00:00Z",
    ...patch,
  });
  await expect(reviewEpisodeDelivery(delivery, "approve", "", "user", 1)).rejects.toThrow(
    "response mismatch"
  );
});
it("resolves the video through the Crew ACL route, never treating a node ID as a media ID", async () => {
  vi.mocked(api.get).mockResolvedValue({
    node: {
      id: node,
      kind: "file",
      status: "active",
      name: "video",
      media: { id, kind: "video", contentType: "video/mp4" },
    },
  });
  expect((await fetchEpisodeVideo("crew", node, signal)).media.id).toBe(id);
  expect(api.get).toHaveBeenCalledWith(`/crews/crew/assets/nodes/${node}`, {
    service: "aurora",
    signal,
  });
});
it("rejects an asset response for another node", async () => {
  vi.mocked(api.get).mockResolvedValue({
    node: {
      id,
      kind: "file",
      status: "active",
      name: "video",
      media: { id, kind: "video", contentType: "video/mp4" },
    },
  });
  await expect(fetchEpisodeVideo("crew", node, signal)).rejects.toThrow("scope mismatch");
});
