import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LikenessOutputsPanel } from "./likeness-outputs-panel";
const h = vi.hoisted(() => ({
  list: vi.fn(),
  submit: vi.fn(),
  preview: vi.fn(),
  generation: 1,
  pending: null as null | { clientKey: string; scope: { kind: "all" } },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) =>
    key === "likenessOutputs.receipt" ? "Blocked count: {count}" : key,
}));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "key" } }));
vi.mock("expo-image", () => ({ Image: () => <span>Preview image</span> }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <span>Preview video</span>,
}));
vi.mock("./likeness-outputs-api", () => ({
  loadLikenessOutputs: h.list,
  likenessTakedownBox: () => ({ read: () => h.pending }),
  prepareLikenessTakedown: (
    characterId: string,
    characterName: string,
    rows: unknown,
    scope: unknown,
    clientKey: string
  ) => ({ characterId, characterName, rows, scope, clientKey }),
  submitLikenessTakedown: h.submit,
  previewLikenessOutput: h.preview,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress, disabled }: any) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const row = (moderationStatus = "unknown") => ({
  jobId: "job-12345678",
  projectId: "project-12345678",
  createdAt: "2026-10-01T00:00:00Z",
  status: "completed",
  outputs: [{ assetId: "asset", mimeType: "image/png", moderationStatus }],
});
let host: HTMLDivElement, root: Root;
const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent === label);
const click = (label: string) => act(async () => buttons(label)[0]!.click());
const render = () =>
  act(async () =>
    root.render(
      <LikenessOutputsPanel
        characterId="likeness"
        characterName="My likeness"
        userId="actor"
        generation={1}
      />
    )
  );
async function openAndSubmit() {
  await render();
  await click("likenessOutputs.title");
  await click("likenessOutputs.takeAll");
  await click("likenessOutputs.confirm");
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pending = null;
  h.list.mockResolvedValue([row()]);
  h.submit.mockResolvedValue({ blocked: 1 });
  h.preview.mockResolvedValue({ url: "https://fixture.test/image", mimeType: "image/png" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("clears the stale list and preview while refreshing a successful takedown", async () => {
  let finish!: (rows: ReturnType<typeof row>[]) => void;
  h.list.mockResolvedValueOnce([row()]).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await click("likenessOutputs.title");
  await click("likenessOutputs.preview");
  expect(host.textContent).toContain("Preview image");
  await click("likenessOutputs.takeAll");
  await click("likenessOutputs.confirm");
  expect(h.list).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Blocked count: 1");
  expect(host.textContent).toContain("Loading");
  expect(host.textContent).not.toContain("Preview image");
  expect(buttons("likenessOutputs.preview")).toHaveLength(0);
  await act(async () => finish([row("blocked")]));
  expect(host.textContent).toContain("likenessOutputs.blocked");
  expect(host.textContent).not.toContain("Loading");
  expect(buttons("likenessOutputs.preview")).toHaveLength(0);
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("preserves the receipt when the post-takedown read fails, without exposing stale actions", async () => {
  h.list.mockResolvedValueOnce([row()]).mockRejectedValueOnce(new Error("Output access revoked"));
  await openAndSubmit();
  expect(host.textContent).toContain("Blocked count: 1");
  expect(host.textContent).toContain("Output access revoked");
  expect(buttons("likenessOutputs.preview")).toHaveLength(0);
  expect(buttons("likenessOutputs.takeAll")).toHaveLength(0);
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("uses refreshed unknown status rather than inferring a full block from a partial receipt", async () => {
  h.submit.mockResolvedValue({ blocked: 0 });
  await openAndSubmit();
  expect(h.list).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Blocked count: 0");
  expect(host.textContent).toContain("likenessOutputs.unknown");
  expect(host.textContent).not.toContain("likenessOutputs.blocked");
  expect(buttons("likenessOutputs.preview")).toHaveLength(1);
});
it("keeps a lost response pending without refreshing it into apparent success", async () => {
  h.submit.mockImplementation(async () => {
    h.pending = { clientKey: "key", scope: { kind: "all" } };
    throw new Error("Lost reply");
  });
  await openAndSubmit();
  expect(host.textContent).toContain("likenessOutputs.pending");
  expect(host.textContent).not.toContain("Blocked count:");
  expect(h.list).toHaveBeenCalledTimes(1);
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("aborts the post-takedown refresh when the output panel closes", async () => {
  let signal!: AbortSignal;
  h.list.mockResolvedValueOnce([row()]).mockImplementationOnce((_id, _generation, s) => {
    signal = s;
    return new Promise(() => {});
  });
  await openAndSubmit();
  await click("likenessOutputs.hide");
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Blocked count:");
});
