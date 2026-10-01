import { beforeEach, expect, it, vi } from "vitest";
import { conversationOutbox } from "./conversation-outbox";
import { durableRecordKey } from "@/lib/durable-record-key";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
let raw: string | null;
const storage = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("restores an immutable send across instances with original client key and attachment IDs", () => {
  const intent = {
    body: "",
    clientKey: "stable",
    attachments: [
      {
        source: "upload" as const,
        mediaAssetId: "11111111-1111-4111-8111-111111111111",
        name: "shot.mp4",
      },
    ],
  };
  conversationOutbox("chat", "user", 1, storage).save(intent);
  intent.attachments[0].name = "changed";
  expect(conversationOutbox("chat", "user", 1, storage).read()).toMatchObject({
    clientKey: "stable",
    attachments: [{ name: "shot.mp4" }],
  });
});
it("persists clear receipts and preserves text mentions without inventing attachments", () => {
  const box = conversationOutbox("chat", "user", 1, storage);
  box.save({
    body: "Hi @Artist",
    clientKey: "key",
    mentions: [{ userId: "2", label: "Artist" }],
    attachments: [],
  });
  expect(box.read()).toMatchObject({ body: "Hi @Artist", clientKey: "key" });
  box.clear("key");
  expect(conversationOutbox("chat", "user", 1, storage).read()).toBeNull();
});
it("fails closed for corrupt storage, stale sessions and failed persistence", () => {
  const box = conversationOutbox("chat", "user", 1, storage);
  raw = "invalid";
  expect(() => box.read()).toThrow();
  h.generation = 2;
  expect(() => box.clear("key")).toThrow("expired");
  expect(raw).toBe("invalid");
  expect(() =>
    conversationOutbox("chat", "user", 2, {
      read: () => null,
      write: () => {
        throw new Error("disk full");
      },
    }).save({ body: "Hello", clientKey: "key" })
  ).toThrow("disk full");
});
it("isolates persisted records by namespace, account and conversation", () => {
  const keys = [
    durableRecordKey("send", "a", "1"),
    durableRecordKey("send", "b", "1"),
    durableRecordKey("send", "a", "2"),
    durableRecordKey("upload", "a", "1"),
  ];
  expect(new Set(keys).size).toBe(4);
});
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com/aurora" } },
}));
it("does not overwrite a different pending message or clear its receipt", () => {
  const a = conversationOutbox("chat", "user", 1, storage);
  const b = conversationOutbox("chat", "user", 1, storage);
  a.save({ body: "First", clientKey: "first" });
  expect(() => b.save({ body: "Second", clientKey: "second" })).toThrow("Another message");
  expect(() => b.clear("second")).toThrow("Another message");
  expect(a.read()?.clientKey).toBe("first");
});
