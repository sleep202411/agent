import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AcademyCoursesForCertificate } from "./academy-courses";
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  open: vi.fn(),
  active: true,
  t: (key: string) => key,
}));
vi.mock("./academy-courses-api", () => ({
  fetchCertificateCourses: h.fetch,
  academyCourseUrl: (id: string, locale: string) =>
    `https://www.fizzdragon.com/${locale}/courses/${id}`,
}));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: h.open }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ backgroundElement: "#222" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => "en-US" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const page = {
  certificateId: 13,
  items: [{ courseId: "42", title: "Producer Course" }],
  nextCursor: null,
};
const render = (id = 13) =>
  act(async () => root.render(<AcademyCoursesForCertificate certificateId={id} />));
beforeEach(() => {
  vi.resetAllMocks();
  h.active = true;
  h.fetch.mockResolvedValue(page);
  h.open.mockResolvedValue({ type: "dismiss" });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("opens the mapped Web course without a native Courses route", async () => {
  await render();
  await act(async () => host.querySelector("button")!.click());
  expect(h.open).toHaveBeenCalledWith("https://www.fizzdragon.com/en-US/courses/42");
});
it("discards stale courses when the selected certificate changes", async () => {
  let finish!: (value: typeof page) => void;
  h.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  const signal = h.fetch.mock.calls[0][2] as AbortSignal;
  h.fetch.mockResolvedValueOnce({ certificateId: 14, items: [], nextCursor: null });
  await render(14);
  await act(async () => finish(page));
  expect(signal.aborted).toBe(true);
  expect(host.textContent).not.toContain("Producer Course");
  expect(host.textContent).toContain("academyCourses.empty");
});
it("cancels reads when backgrounded and retries errors visibly", async () => {
  h.fetch.mockRejectedValueOnce(new Error("Regional catalogue offline"));
  await render();
  expect(host.textContent).toContain("Regional catalogue offline");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Producer Course");
  const signal = h.fetch.mock.calls.at(-1)![2] as AbortSignal;
  h.active = false;
  await render();
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toBe("");
});
