import { describe, it, expect } from "vitest";
import { K, TTL, ENTITY_TYPES, parseDraftKey } from "./redis-keys";

describe("TTL constants", () => {
  it("draft and idem TTLs match (both 7d)", () => {
    expect(TTL.DRAFT).toBe(TTL.IDEM);
    expect(TTL.DRAFT).toBe(7 * 24 * 3600);
  });
  it("workflow TTL is 30d", () => {
    expect(TTL.WORKFLOW).toBe(30 * 24 * 3600);
  });
  it("Java short cache is under a minute-scale value", () => {
    expect(TTL.JAVA_CACHE_SHORT).toBeLessThan(TTL.JAVA_CACHE_MEDIUM);
  });
});

describe("K.chatMsg / chatMeta", () => {
  it("builds chat message list key", () => {
    expect(K.chatMsg("conv-123")).toBe("chat:msg:conv-123");
  });
  it("builds chat meta key", () => {
    expect(K.chatMeta("conv-123")).toBe("chat:meta:conv-123");
  });
});

describe("K.draft / draftIndex / draftScan", () => {
  it("builds draft key with runId, entityType, clientRefId", () => {
    expect(K.draft("run-1", "role", "client-abc")).toBe("draft:run-1:role:client-abc");
  });
  it("builds draft index key", () => {
    expect(K.draftIndex("run-1")).toBe("draft:run-1:index");
  });
  it("builds draft SCAN pattern", () => {
    expect(K.draftScan("run-1")).toBe("draft:run-1:*");
  });
});

describe("K.idem", () => {
  it("scopes by workspace + entity type + clientRefId", () => {
    expect(K.idem("ws-1", "role", "abc-123")).toBe("idem:ws-1:role:abc-123");
  });
  it("distinguishes across entity types", () => {
    expect(K.idem("ws-1", "role", "x")).not.toBe(K.idem("ws-1", "scene", "x"));
  });
});

describe("K.workflow*", () => {
  it("builds state, events, cancel, resume keys under run namespace", () => {
    expect(K.workflowState("r1")).toBe("workflow:run:r1:state");
    expect(K.workflowEvents("r1")).toBe("workflow:run:r1:events");
    expect(K.workflowCancel("r1")).toBe("workflow:run:r1:cancel");
    expect(K.workflowResume("r1")).toBe("workflow:run:r1:resume_payload");
  });
  it("builds user and workspace index keys", () => {
    expect(K.workflowRunsByUser("u1")).toBe("workflow:user:u1:runs");
    expect(K.workflowRunsByWorkspace("ws1")).toBe("workflow:workspace:ws1:runs");
  });
});

describe("K.chunk / embedIndex", () => {
  it("accepts non-negative integer indices only", () => {
    expect(K.chunk("d1", 0)).toBe("chunks:d1:0");
    expect(K.chunk("d1", 42)).toBe("chunks:d1:42");
    expect(() => K.chunk("d1", -1)).toThrow();
    expect(() => K.chunk("d1", 1.5)).toThrow();
  });
  it("builds chunk meta and embedding index keys", () => {
    expect(K.chunkMeta("d1")).toBe("chunks:d1:meta");
    expect(K.embedIndex("d1")).toBe("embeddings:d1");
  });
});

describe("K.javaCache", () => {
  it("namespaces by endpoint + param hash", () => {
    expect(K.javaCache("abc", "def")).toBe("cache:java:abc:def");
  });
});

describe("ID safety", () => {
  it("rejects empty string IDs", () => {
    expect(() => K.chatMsg("")).toThrow(/non-empty/);
    expect(() => K.draft("", "role", "x")).toThrow(/non-empty/);
  });
  it("rejects IDs containing the `:` delimiter", () => {
    expect(() => K.chatMsg("foo:bar")).toThrow(/reserved character/);
    expect(() => K.draft("a:b", "role", "x")).toThrow(/reserved character/);
  });
  it("rejects IDs containing the `*` wildcard", () => {
    expect(() => K.chatMeta("foo*")).toThrow(/reserved character/);
  });
  it("rejects IDs containing newlines", () => {
    expect(() => K.workflowState("foo\nbar")).toThrow(/reserved character/);
  });
});

describe("parseDraftKey", () => {
  it("round-trips a well-formed draft key", () => {
    const k = K.draft("run-1", "role", "abc");
    expect(parseDraftKey(k)).toEqual({
      runId: "run-1",
      entityType: "role",
      clientRefId: "abc",
    });
  });
  it("rejects keys from a different namespace", () => {
    expect(parseDraftKey("chat:msg:x")).toBeNull();
    expect(parseDraftKey("idem:a:role:b")).toBeNull();
  });
  it("rejects keys with unknown entity types", () => {
    expect(parseDraftKey("draft:run-1:unicorn:abc")).toBeNull();
  });
  it("rejects malformed keys (wrong number of parts)", () => {
    expect(parseDraftKey("draft:run-1:role")).toBeNull();
    expect(parseDraftKey("draft:run-1:role:abc:extra")).toBeNull();
  });
});

describe("ENTITY_TYPES", () => {
  it("includes every entity type the workflow engine writes", () => {
    for (const t of ["film", "episode", "role", "scene", "prop", "script", "shot"]) {
      expect(ENTITY_TYPES).toContain(t);
    }
  });
});
