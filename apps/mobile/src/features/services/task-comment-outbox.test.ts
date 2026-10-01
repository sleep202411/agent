import { beforeEach, expect, it, vi } from "vitest";
import { taskCommentOutbox } from "./task-comment-outbox";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com" } },
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
let raw: string | null;
const store = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
const replyId = "11111111-1111-4111-8111-111111111111";
const pending = {
  clientKey: "original-key",
  comment: {
    clientKey: "original-key",
    body: "@Artist Hello",
    replyToId: replyId,
    mentions: [{ userId: "2", label: "Artist" }],
    attachments: [
      {
        source: "upload" as const,
        mediaAssetId: "22222222-2222-4222-8222-222222222222",
        name: "Film.mp4",
      },
    ],
  },
  reply: { id: replyId, body: "Original parent" },
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("restores exact comment, reply, mentions and attachments across instances", () => {
  const first = taskCommentOutbox("crew", "task", "user", 1, store);
  first.save(pending);
  const restored = taskCommentOutbox("crew", "task", "user", 1, store);
  expect(restored.read()).toEqual(pending);
  expect(() =>
    restored.save({ ...pending, comment: { ...pending.comment, body: "@Artist changed" } })
  ).toThrow("pending");
  expect(() => restored.clear("different")).toThrow("pending");
  restored.clear(pending.clientKey);
  expect(first.read()).toBeNull();
});
it("rejects mismatched reply metadata, stale accounts and corrupt records", () => {
  const box = taskCommentOutbox("crew", "task", "user", 1, store);
  expect(() => box.save({ ...pending, reply: undefined })).toThrow("target");
  box.save(pending);
  h.generation = 2;
  expect(() => box.clear(pending.clientKey)).toThrow("expired");
  h.generation = 1;
  raw = "invalid";
  expect(() => box.save(pending)).toThrow();
  expect(raw).toBe("invalid");
});
