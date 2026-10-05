import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import { StoryCanvasMediaSync } from "./story-canvas-media-sync";
const h = vi.hoisted(() => ({
  generation: 1,
  pending: null as null | { clientKey: string; yjsUpdateBase64: string },
  canPrepare: true,
  reader: null as null | { onResult(value: CanvasLoaded): void },
  encoder: null as null | {
    loaded: CanvasLoaded;
    edit: { action: string; job?: { id: string } };
    onResult(value: string | null): void;
  },
  jobs: vi.fn(),
  prepare: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "key" } }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress(): void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("../api/story-canvas-generation", () => ({ loadTrackedCanvasJobs: h.jobs }));
vi.mock("../lib/story-canvas-reconciliation", () => ({
  canvasReconciliation: () => ({
    read: () => h.pending,
    canPrepare: () => h.canPrepare,
    prepare: h.prepare,
    resume: h.resume,
  }),
}));
vi.mock("./story-canvas-reader", () => ({
  StoryCanvasReader: (props: NonNullable<typeof h.reader>) => {
    h.reader = props;
    return null;
  },
}));
vi.mock("./story-canvas-encoder", () => ({
  StoryCanvasEncoder: (props: NonNullable<typeof h.encoder>) => {
    h.encoder = props;
    return null;
  },
}));
const scope = { projectId: "project", documentId: "document", generation: 1 };
const loaded = { documentId: "document" } as CanvasLoaded;
let root: Root, host: HTMLDivElement;
const saved = vi.fn(),
  snapshot = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  h.generation = 1;
  h.pending = null;
  h.canPrepare = true;
  h.reader = null;
  h.encoder = null;
  h.jobs.mockResolvedValue([{ id: "job" }]);
  h.prepare.mockImplementation((command) => {
    h.pending = command;
  });
  h.resume.mockImplementation(async () => {
    h.pending = null;
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
const render = () =>
  act(async () => {
    root.render(
      <StoryCanvasMediaSync scope={scope} userId="user" onSaved={saved} onSnapshot={snapshot} />
    );
  });
const read = async () => {
  await act(async () => {
    h.reader!.onResult(loaded);
  });
  await act(async () => {
    h.reader!.onResult(loaded);
  });
};
const encode = (value: string | null) =>
  act(async () => {
    h.encoder!.onResult(value);
  });
it("encodes the tracked result and persists exact bytes before saving", async () => {
  await render();
  await read();
  expect(h.encoder!.edit).toEqual({ action: "generation", job: { id: "job" } });
  await encode("delta");
  expect(h.prepare).toHaveBeenCalledWith({ clientKey: "key", yjsUpdateBase64: "delta" });
  expect(h.prepare.mock.invocationCallOrder[0]).toBeLessThan(h.resume.mock.invocationCallOrder[0]!);
  expect(saved).toHaveBeenCalledOnce();
});
it("continues unchanged jobs into shot reconciliation without writing", async () => {
  await render();
  await read();
  await encode(null);
  expect(h.encoder!.edit).toEqual({ action: "reconcileShotMedia" });
  await encode(null);
  expect(snapshot).toHaveBeenCalledWith(loaded);
  expect(h.prepare).not.toHaveBeenCalled();
  expect(h.resume).not.toHaveBeenCalled();
});
it("retries a lost save from its journal without reloading or encoding", async () => {
  h.resume.mockRejectedValueOnce(Error("Reply lost"));
  await render();
  await read();
  await encode("delta");
  expect(host.textContent).toContain("Reply lost");
  expect(h.pending?.yjsUpdateBase64).toBe("delta");
  await act(async () => {
    host.querySelector("button")!.click();
  });
  expect(h.jobs).toHaveBeenCalledOnce();
  expect(h.prepare).toHaveBeenCalledOnce();
  expect(h.resume).toHaveBeenCalledTimes(2);
  expect(saved).toHaveBeenCalledOnce();
});
it("rejects retired-account callbacks and defers when a manual draft appears", async () => {
  await render();
  await read();
  h.generation++;
  await encode("delta");
  expect(h.prepare).not.toHaveBeenCalled();
  h.generation = 1;
  h.canPrepare = false;
  await encode("delta");
  expect(h.prepare).not.toHaveBeenCalled();
});

it("ignores a job lookup that finishes after the account changes", async () => {
  let resolve!: (value: { id: string }[]) => void;
  h.jobs.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  await act(async () => {
    h.reader!.onResult(loaded);
  });
  h.generation++;
  await act(async () => {
    resolve([{ id: "job" }]);
  });
  expect(h.encoder).toBeNull();
  expect(h.prepare).not.toHaveBeenCalled();
});

it("re-reads the document after lookup before encoding against the current card state", async () => {
  await render();
  await act(async () => {
    h.reader!.onResult(loaded);
  });
  expect(h.encoder).toBeNull();
  const fresh = { ...loaded, sequence: 8 };
  await act(async () => {
    h.reader!.onResult(fresh);
  });
  expect(h.encoder!.loaded).toBe(fresh);
  expect(h.jobs).toHaveBeenCalledOnce();
});
