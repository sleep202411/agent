import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CourseCertificate } from "./course-certificate";
const h = vi.hoisted(() => ({ load: vi.fn(), active: true, t: (key: string) => key }));
vi.mock("./api", () => ({ getCourseCertificate: h.load }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  h.active = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = () => act(async () => root.render(<CourseCertificate courseId="7" />));
it("shows the authoritative badge and approval requirement", async () => {
  h.load.mockResolvedValue({ courseId: "7", certificate: { id: 13, name: "Editing" } });
  await render();
  expect(host.textContent).toContain("Editing");
  expect(host.textContent).toContain("courses.certificateApproval");
});
it("distinguishes unavailable mappings from an unassigned course and retries", async () => {
  h.load.mockRejectedValueOnce(new Error("Catalogue unavailable"));
  await render();
  expect(host.textContent).toContain("Catalogue unavailable");
  expect(host.textContent).not.toContain("courses.certificateUnassigned");
  h.load.mockResolvedValueOnce({ courseId: "7", certificate: null });
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("courses.certificateUnassigned");
});
it("ignores a mapping that resolves after leaving the screen", async () => {
  let resolve!: (value: unknown) => void;
  h.load.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  const signal = h.load.mock.calls[0][1] as AbortSignal;
  h.active = false;
  await render();
  await act(async () => resolve({ courseId: "7", certificate: { id: 13, name: "Old" } }));
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Old");
});
