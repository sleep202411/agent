import { act, forwardRef, useImperativeHandle, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryCanvasReader } from "./story-canvas-reader";
const h = vi.hoisted(() => ({
  open: vi.fn(),
  send: vi.fn(),
  generation: 1,
  receive: (_raw: unknown) => {},
  fail: () => {},
}));
vi.mock("../api/story-canvas-document", () => ({ openStoryCanvasDocument: h.open }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000003" },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./story-canvas-runtime-frame", () => ({
  CanvasRuntimeFrame: forwardRef(function Frame(
    props: { onMessage(raw: unknown): void; onError(): void },
    ref
  ) {
    h.receive = props.onMessage;
    h.fail = props.onError;
    useImperativeHandle(ref, () => ({ send: h.send }), []);
    return <span data-frame />;
  }),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot = {
  document: {
    id: id(2),
    owner: { kind: "story_project", projectId: id(1) },
    storyProjectId: id(1),
    platformProjectId: null,
    currentSequence: 1,
    snapshotSequence: 1,
    crdtStateBase64: "AAA=",
  },
  operations: [],
  sequence: 1,
};
const result = {
  type: "loaded",
  sessionId: id(3),
  documentId: id(2),
  sequence: 1,
  requestId: 1,
  state: "AAA=",
  snapshot: { meta: {}, nodes: {}, edges: {}, groups: {}, assets: {} },
};
let element: HTMLDivElement, root: Root;
const onResult = vi.fn(),
  onError = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.open.mockResolvedValue(snapshot);
  element = document.createElement("div");
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});
const render = async (key = 1) => {
  await act(async () =>
    root.render(
      <StoryCanvasReader
        key={key}
        scope={{ projectId: id(1), generation: 1 }}
        title="Canvas"
        runtimeError="Please retry"
        onResult={onResult}
        onError={onError}
      />
    )
  );
};
const ready = async () => {
  await act(async () => h.receive(JSON.stringify({ type: "ready", sessionId: id(3) })));
};
it("waits for decoded data then releases the hidden runtime", async () => {
  await render();
  await ready();
  expect(h.send).toHaveBeenCalledOnce();
  await act(async () => h.receive(JSON.stringify(result)));
  expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
  expect(element.querySelector("[data-frame]")).toBeNull();
});
it("loads a platform canvas through its scoped loader without Story bootstrap", async () => {
  const scope = {
    kind: "platform" as const,
    projectId: id(1),
    generation: 1,
    workspaceId: id(4),
    sectionId: id(5),
    documentId: id(2),
  };
  const load = vi.fn().mockResolvedValue({
    ...snapshot,
    document: {
      ...snapshot.document,
      owner: { kind: "platform_project", projectId: id(1) },
      storyProjectId: null,
      platformProjectId: id(1),
      workspaceId: id(4),
      sectionId: id(5),
    },
  });
  await act(async () =>
    root.render(
      <StoryCanvasReader
        scope={scope}
        platform={{ scope, load }}
        title="Canvas"
        runtimeError="Please retry"
        onResult={onResult}
        onError={onError}
      />
    )
  );
  expect(load).toHaveBeenCalledWith(scope, expect.any(AbortSignal));
  expect(h.open).not.toHaveBeenCalled();
  await ready();
  await act(async () => h.receive(JSON.stringify(result)));
  expect(onResult).toHaveBeenCalledExactlyOnceWith(result);
});
it("does not fall back to Story bootstrap for inconsistent platform identity", async () => {
  const scope = {
    kind: "platform" as const,
    projectId: id(9),
    generation: 1,
    workspaceId: id(4),
    sectionId: id(5),
    documentId: id(2),
  };
  const load = vi.fn();
  await act(async () =>
    root.render(
      <StoryCanvasReader
        scope={{ projectId: id(1), generation: 1 }}
        platform={{ scope, load }}
        title="Canvas"
        runtimeError="Please retry"
        onResult={onResult}
        onError={onError}
      />
    )
  );
  expect(load).not.toHaveBeenCalled();
  expect(h.open).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledExactlyOnceWith("Canvas reader scope mismatch.");
});
it("aborts a pending read when leaving and ignores its late response", async () => {
  let resolve!: (value: typeof snapshot) => void;
  h.open.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  await render();
  const signal = h.open.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(null));
  await act(async () => resolve(snapshot));
  expect(signal.aborted).toBe(true);
  expect(onResult).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
});
it("ignores a runtime response after account retirement", async () => {
  await render();
  await ready();
  h.generation++;
  await act(async () => h.receive(JSON.stringify(result)));
  expect(onResult).not.toHaveBeenCalled();
});
it("surfaces transport errors without mounting a frame", async () => {
  h.open.mockRejectedValue(Error("Story access revoked"));
  await render();
  expect(onError).toHaveBeenCalledWith("Story access revoked");
  expect(element.querySelector("[data-frame]")).toBeNull();
});
it("times out a silent runtime and supports a fresh attempt", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () => vi.advanceTimersByTime(30000));
  expect(onError).toHaveBeenCalledWith("Please retry");
  expect(element.querySelector("[data-frame]")).toBeNull();
  await render(2);
  await ready();
  await act(async () => h.receive(JSON.stringify(result)));
  expect(onResult).toHaveBeenCalledOnce();
});
it("surfaces runtime termination once and ignores late messages", async () => {
  await render();
  await ready();
  await act(async () => {
    h.fail();
    h.fail();
  });
  await act(async () => h.receive(JSON.stringify(result)));
  expect(onError).toHaveBeenCalledExactlyOnceWith("Please retry");
  expect(onResult).not.toHaveBeenCalled();
});
