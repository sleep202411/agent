import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformProjectCover } from "./platform-project-cover";
const h = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/features/crew-assets/api", () => ({ fetchCrewAssetAccess: h.access }));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
vi.mock("expo-image", () => ({
  Image: ({ source, onError }: { source: { uri: string }; onError: () => void }) => (
    <img src={source.uri} onError={onError} />
  ),
}));
const id = "11111111-1111-4111-8111-111111111111";
const project = {
  id,
  workspaceId: id,
  name: "Film",
  description: "",
  version: 1,
  updatedAt: "2026-10-02T00:00:00Z",
  status: "active" as const,
  visibility: "private" as const,
  coverAssetId: id,
};
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("resolves authenticated asset access and retries image failures", async () => {
  h.access.mockResolvedValue({ url: "https://cdn.example/cover.jpg" });
  await act(async () => root.render(<PlatformProjectCover project={project} />));
  expect(h.access).toHaveBeenCalledWith(id, expect.any(AbortSignal));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/cover.jpg");
  await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.textContent).toContain("studioProjects.coverFailed");
  await act(async () => host.querySelector("button")!.click());
  expect(h.access).toHaveBeenCalledTimes(2);
  expect(host.querySelector("img")).not.toBeNull();
});
it("does not show the previous cover after a project change and failed access", async () => {
  h.access
    .mockResolvedValueOnce({ url: "https://cdn.example/cover.jpg" })
    .mockRejectedValueOnce(Error("Access denied"));
  await act(async () => root.render(<PlatformProjectCover project={project} />));
  await act(async () =>
    root.render(
      <PlatformProjectCover
        project={{ ...project, id: "22222222-2222-4222-8222-222222222222", version: 2 }}
      />
    )
  );
  expect(host.textContent).toContain("Access denied");
  expect(host.querySelector("img")).toBeNull();
});
