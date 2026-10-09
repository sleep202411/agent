import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CourseEnrollGate, CourseHomeworkPanel } from "./course-enrollment";
const h = vi.hoisted(() => ({
  user: "student" as string | null,
  course: vi.fn(),
  enroll: vi.fn(),
  submit: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: h.user ? { id: h.user } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, args?: { amount: string }) =>
    args ? `${key} ${args.amount}` : key,
}));
vi.mock("@/src/i18n/locale-url", () => ({
  localizePath: (path: string) => path,
}));
vi.mock("./api", () => ({
  learningApi: {
    course: (...a: unknown[]) => h.course(...a),
    enroll: (...a: unknown[]) => h.enroll(...a),
    submit: (...a: unknown[]) => h.submit(...a),
  },
}));
vi.mock("@/src/lib/media-upload", () => ({
  uploadFileViaSignedUrl: (...a: unknown[]) => h.upload(...a),
}));
let root: Root, host: HTMLDivElement, qc: QueryClient;
const enrollment = { id: "e", version: 2, status: "enrolled", assetIds: [], feedback: null };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  h.user = "student";
  h.course.mockResolvedValue({
    offering: { version: 3, enabled: true, priceCredits: "200" },
    enrollment: null,
  });
  h.enroll.mockResolvedValue({});
  h.submit.mockResolvedValue({});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
});
async function renderGate() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <CourseEnrollGate courseId="14" />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function renderHomework() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <CourseHomeworkPanel courseId="14" />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
it("charges only on explicit enrollment and refreshes playback after purchase", async () => {
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await renderGate();
  expect(host.textContent).toContain("price 200");
  expect(h.enroll).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(h.enroll).toHaveBeenCalledWith("14", 3, expect.any(AbortSignal));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["public-course-play", 14] });
});
it("preserves the purchase error and does not display a false enrollment", async () => {
  h.enroll.mockRejectedValue(new Error("Insufficient credits"));
  await renderGate();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Insufficient credits");
  expect(host.querySelector("form")).toBeNull();
});
it("keeps homework inside the course after enrollment", async () => {
  h.course.mockResolvedValue({ enrollment, offering: null });
  await renderHomework();
  expect(host.textContent).toContain("homeworkSection");
  expect(host.querySelector("form")).not.toBeNull();
});
it("clears private homework drafts on account switch", async () => {
  h.course.mockResolvedValue({ enrollment, offering: null });
  await renderHomework();
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      "Private work"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector("textarea")?.value).toBe("Private work");
  h.user = "another-student";
  await renderHomework();
  expect(host.querySelector("textarea")?.value).toBe("");
});
it("aborts pending uploads on account switch before submitting homework", async () => {
  h.course.mockResolvedValue({ enrollment, offering: null });
  let finish!: (value: { mediaAssetId: string }) => void;
  h.upload.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await renderHomework();
  await act(async () => {
    const input = host.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      value: [new File(["work"], "homework.pdf", { type: "application/pdf" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const signal = h.upload.mock.calls[0][1].signal as AbortSignal;
  h.user = "another-student";
  await renderHomework();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ mediaAssetId: "asset" }));
  expect(h.submit).not.toHaveBeenCalled();
});
