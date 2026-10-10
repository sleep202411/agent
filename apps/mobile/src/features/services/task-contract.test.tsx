import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskContract } from "./task-contract";
const h = vi.hoisted(() => ({ active: true, generation: 1, get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => {
  const t = (key: string) => key;
  return { useTranslations: () => t };
});
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./conversation-file", () => ({
  ConversationFile: ({ mediaAssetId, name }: { mediaAssetId: string; name: string }) => (
    <span>
      file:{mediaAssetId}:{name}
    </span>
  ),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const node = {
  id: id(1),
  parentId: null,
  name: "Contract.pdf",
  kind: "file",
  status: "active",
  effectivePermission: "view",
  linkedStudio: null,
  media: { id: id(2) },
  updatedAt: "2026-10-04T00:00:00Z",
  favorite: false,
};
let root: Root, host: HTMLDivElement;
const mount = () =>
  act(async () =>
    root.render(<TaskContract crewId="crew" assetId={id(1)} userId="a" generation={1} />)
  );
const click = () => act(async () => host.querySelector("button")!.click());
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("members/me") ? { userId: "a", permissions: ["assets.view"] } : { node }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("checks membership and the linked node on demand before exposing the file opener", async () => {
  await mount();
  expect(h.get).not.toHaveBeenCalled();
  await click();
  expect(h.get.mock.calls.map((c) => c[0])).toEqual([
    "/crews/crew/members/me",
    `/crews/crew/assets/nodes/${id(1)}`,
  ]);
  expect(host.textContent).toContain(`file:${id(2)}:Contract.pdf`);
});
it("clears the file on access revocation and supports retry", async () => {
  await mount();
  await click();
  h.get.mockRejectedValueOnce(Error("Access denied"));
  await click();
  expect(host.textContent).not.toContain("file:");
  expect(host.textContent).toContain("Access denied");
  await click();
  expect(host.textContent).toContain("Contract.pdf");
});
it.each([
  { ...node, kind: "folder", media: null },
  { ...node, media: null },
])("rejects a node without a usable file", async (value) => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("members/me") ? { userId: "a", permissions: ["assets.view"] } : { node: value }
  );
  await mount();
  await click();
  expect(host.textContent).toContain("taskContract.unavailable");
  expect(host.textContent).not.toContain("file:");
});
it("clears file access on background and refuses stale account responses", async () => {
  await mount();
  await click();
  h.active = false;
  await mount();
  expect(host.textContent).toBe("");
  h.active = true;
  await mount();
  expect(host.textContent).not.toContain("file:");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { userId: "a", permissions: ["assets.view"] };
  });
  await click();
  expect(host.textContent).not.toContain("file:");
});
