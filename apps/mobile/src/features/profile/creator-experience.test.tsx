import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CreatorExperience } from "./creator-experience";
const h = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./experience-api", () => ({ getCreatorExperience: h.load }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
  ActivityIndicator: () => <span>loading</span>,
  StyleSheet: { create: (value: unknown) => value },
  Platform: { select: (values: Record<string, unknown>) => values.web ?? values.default },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui", () => ({
  SectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const row = {
  id: "1",
  title: "Director",
  organization: "Studio",
  location: "SG",
  startTime: "2025-01",
  endTime: "",
  description: "A film",
};
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const render = (id = "alice") => act(async () => root.render(<CreatorExperience creatorId={id} />));
it("shows public work experience and localized ongoing dates", async () => {
  h.load.mockResolvedValue([row]);
  await render();
  expect(host.textContent).toContain("Director");
  expect(host.textContent).toContain("2025-01 — creatorDetail.present · SG");
  expect(host.textContent).toContain("A film");
});
it("omits a verified empty work history", async () => {
  h.load.mockResolvedValue([]);
  await render();
  expect(host.textContent).toBe("");
});
it("shows the server error and supports retry", async () => {
  h.load.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce([row]);
  await render();
  expect(host.textContent).toContain("Offline");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Director");
  expect(h.load).toHaveBeenCalledTimes(2);
});
it("aborts and ignores an old creator's delayed response", async () => {
  let finish!: (rows: (typeof row)[]) => void;
  h.load
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValueOnce([{ ...row, title: "Bob's role" }]);
  await render();
  const signal = h.load.mock.calls[0][1] as AbortSignal;
  await render("bob");
  expect(signal.aborted).toBe(true);
  await act(async () => finish([row]));
  expect(host.textContent).toContain("Bob's role");
  expect(host.textContent).not.toContain("Director");
});
