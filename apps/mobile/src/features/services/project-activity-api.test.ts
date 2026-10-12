import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchProjectActivityAccess,
  fetchProjectActivityPage,
  postProjectActivity,
  projectActivityInput,
  ProjectActivityPostError,
} from "./project-activity-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
const id = "11111111-1111-4111-8111-111111111111";
const document = {
  type: "doc" as const,
  content: [
    { type: "paragraph", attrs: { id }, content: [{ type: "text", text: "Ready for review" }] },
  ],
};
const row = {
  id,
  crewId: "crew",
  kind: "comment",
  health: null,
  content: document,
  plainText: "Ready for review",
  progress: null,
  payload: {},
  createdByUserId: "user",
  createdAt: "2026-09-30T01:00:00.000Z",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ userId: "user", permissions: ["production.view"] });
  h.post.mockResolvedValue(row);
});
it("separates project permission from task management", async () => {
  h.get.mockResolvedValue({ userId: "user", permissions: ["tasks.manage", "production.view"] });
  expect(await fetchProjectActivityAccess("crew", "user", 1, signal())).toEqual({
    view: true,
    manage: false,
  });
  await expect(
    postProjectActivity(
      "crew",
      "user",
      1,
      { kind: "update", health: "on_track", content: document },
      signal()
    )
  ).rejects.toMatchObject({ uncertain: false });
  expect(h.post).not.toHaveBeenCalled();
});
it("posts member comments without health or progress", async () => {
  expect(
    await postProjectActivity("crew", "user", 1, { kind: "comment", content: document }, signal())
  ).toEqual(row);
  expect(h.post).toHaveBeenCalledWith("/crews/crew/production-activity", {
    service: "aurora",
    data: { kind: "comment", content: document },
  });
  expect(
    projectActivityInput.safeParse({ kind: "comment", content: document, health: "on_track" })
      .success
  ).toBe(false);
});
it("posts manager health updates with validated progress", async () => {
  h.get.mockResolvedValue({ userId: "user", permissions: ["production.manage"] });
  h.post.mockResolvedValue({ ...row, kind: "update", health: "at_risk", progress: 35 });
  await expect(
    postProjectActivity(
      "crew",
      "user",
      1,
      { kind: "update", content: document, health: "at_risk", progress: 35 },
      signal()
    )
  ).resolves.toMatchObject({ progress: 35 });
});
it("rejects blank, oversized and out-of-range posts before requests", async () => {
  for (const value of [" ", "a".repeat(20001)]) {
    const content = {
      type: "doc" as const,
      content: [{ type: "paragraph", attrs: { id }, content: [{ type: "text", text: value }] }],
    };
    await expect(
      postProjectActivity("crew", "user", 1, { kind: "comment", content }, signal())
    ).rejects.toThrow();
  }
  expect(
    projectActivityInput.safeParse({
      kind: "update",
      health: "on_track",
      content: document,
      progress: 101,
    }).success
  ).toBe(false);
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("does not post after account change during authorization", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return { userId: "user", permissions: ["production.view"] };
  });
  await expect(
    postProjectActivity("crew", "user", 1, { kind: "comment", content: document }, signal())
  ).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("marks lost and mismatched write responses uncertain without retrying", async () => {
  h.post.mockRejectedValueOnce(new Error("Response lost"));
  await expect(
    postProjectActivity("crew", "user", 1, { kind: "comment", content: document }, signal())
  ).rejects.toMatchObject({ uncertain: true, message: "Response lost" });
  expect(h.post).toHaveBeenCalledTimes(1);
  h.post.mockResolvedValue({ ...row, crewId: "other" });
  await expect(
    postProjectActivity("crew", "user", 1, { kind: "comment", content: document }, signal())
  ).rejects.toBeInstanceOf(ProjectActivityPostError);
});
it("loads scoped pages and passes the cursor", async () => {
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  const abort = signal();
  expect(await fetchProjectActivityPage("crew", 1, id, abort)).toEqual({
    items: [row],
    nextCursor: null,
  });
  expect(h.get).toHaveBeenCalledWith("/crews/crew/production-activity", {
    service: "aurora",
    signal: abort,
    params: { limit: 30, cursor: id },
  });
});
it("rejects repeated cursors, duplicate rows and foreign scope", async () => {
  for (const result of [
    { items: [row], nextCursor: id },
    { items: [row, row], nextCursor: null },
    { items: [{ ...row, crewId: "other" }], nextCursor: null },
  ]) {
    h.get.mockResolvedValue(result);
    await expect(fetchProjectActivityPage("crew", 1, id, signal())).rejects.toThrow();
  }
});
it("rejects stale or aborted reads and foreign membership", async () => {
  h.get.mockResolvedValue({ userId: "other", permissions: ["production.view"] });
  await expect(fetchProjectActivityAccess("crew", "user", 1, signal())).rejects.toThrow("mismatch");
  const controller = new AbortController();
  controller.abort();
  await expect(fetchProjectActivityPage("crew", 1, null, controller.signal)).rejects.toThrow(
    "expired"
  );
});
it("stops before POST when the screen leaves during the permission check", async () => {
  const controller = new AbortController();
  h.get.mockImplementation(async () => {
    controller.abort();
    return { userId: "user", permissions: ["production.view"] };
  });
  await expect(
    postProjectActivity(
      "crew",
      "user",
      1,
      { kind: "comment", content: document },
      controller.signal
    )
  ).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it.each([{ plainText: "Different post" }, { health: "at_risk" }, { progress: 50 }])(
  "treats a mismatched comment receipt as uncertain: %o",
  async (patch) => {
    h.post.mockResolvedValue({ ...row, ...patch });
    await expect(
      postProjectActivity("crew", "user", 1, { kind: "comment", content: document }, signal())
    ).rejects.toMatchObject({ uncertain: true });
    expect(h.post).toHaveBeenCalledTimes(1);
  }
);
