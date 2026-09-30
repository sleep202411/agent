import { beforeEach, expect, it, vi } from "vitest";
import { taskDraftStorage } from "./task-draft-storage.native";
const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  fail: false,
  events: [] as string[],
}));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://api.test" } },
}));
vi.mock("expo-file-system", () => ({
  Paths: { document: "document" },
  Directory: class {
    uri: string;
    constructor(base: string, name: string) {
      this.uri = `${base}/${name}`;
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(base: { uri: string }, name: string) {
      this.uri = `${base.uri}/${name}`;
    }
    get exists() {
      return h.files.has(this.uri);
    }
    textSync() {
      return h.files.get(this.uri);
    }
    create() {
      h.files.set(this.uri, "");
    }
    write(value: string) {
      h.events.push("write");
      h.files.set(this.uri, value);
    }
    move(target: { uri: string }, options: { overwrite: boolean }) {
      h.events.push("move");
      expect(options.overwrite).toBe(true);
      if (h.fail) throw new Error("rename failed");
      h.files.set(target.uri, h.files.get(this.uri)!);
      h.files.delete(this.uri);
    }
  },
}));
beforeEach(() => {
  h.files.clear();
  h.events = [];
  h.fail = false;
});
it("replaces snapshots only after the temporary file is complete", () => {
  const store = taskDraftStorage("crew", "alice");
  expect(store.read()).toBeNull();
  store.write("first");
  h.fail = true;
  expect(() => store.write("next")).toThrow("rename failed");
  expect(taskDraftStorage("crew", "alice").read()).toBe("first");
  h.fail = false;
  store.write("complete");
  expect(store.read()).toBe("complete");
  expect(h.events).toEqual(["write", "move", "write", "move", "write", "move"]);
  expect(taskDraftStorage("crew", "bob").read()).toBeNull();
});
