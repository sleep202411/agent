// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCollabDoc, type CollabUser, type CollabDocHandle } from "./use-collab-doc";
import { TEXT_DOC_ROOT_SCHEMA } from "./protocol";
const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    setAwarenessField: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock("./document-provider", () => ({
  DocumentProvider: class {
    doc = {};
    awareness = {};
    setAwarenessField = vi.fn();
    destroy = vi.fn();
    constructor() {
      mocks.instances.push(this);
    }
    retry = vi.fn();
    canRetry() {
      return true;
    }
    getError() {
      return null;
    }
    onError() {
      return () => {};
    }
    getStatus() {
      return "connecting";
    }
    getRtt() {
      return null;
    }
    onStatus() {
      return () => {};
    }
    onRtt() {
      return () => {};
    }
  },
}));
let root: Root;
let observations: Array<{ id: string | null; handle: CollabDocHandle }>;
const user: CollabUser = { id: "alice", name: "Alice", color: "red" };
function Probe({ id, identity = user }: { id: string | null; identity?: CollabUser | null }) {
  const handle = useCollabDoc(id, identity, TEXT_DOC_ROOT_SCHEMA);
  useLayoutEffect(() => {
    observations.push({ id, handle });
  });
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.instances = [];
  observations = [];
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it.each(["b", null])(
  "does not expose the former provider during replacement with %s",
  async (id) => {
    await act(async () => root.render(<Probe id="a" />));
    observations = [];
    await act(async () => root.render(<Probe id={id} />));
    expect(observations[0]?.handle.provider).toBe(null);
    expect(observations[0]?.handle.doc).toBe(null);
    expect(mocks.instances[0]?.destroy).toHaveBeenCalledOnce();
  }
);
it("clears the previous advertised identity when the user becomes unavailable", async () => {
  await act(async () => root.render(<Probe id="a" />));
  const provider = mocks.instances[0]!;
  expect(provider.setAwarenessField).toHaveBeenLastCalledWith("user", user);
  await act(async () => root.render(<Probe id="a" identity={null} />));
  expect(provider.setAwarenessField).toHaveBeenLastCalledWith("user", null);
  expect(mocks.instances).toHaveLength(1);
});
