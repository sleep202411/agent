// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { CourseEditor } from "./course-editor";
import { emptyLocalizedCourse, type Course } from "./types";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./instructor-picker", () => ({ InstructorPicker: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();

const localized = emptyLocalizedCourse();
localized["zh-CN"].title = "Original course";
const course: Course = {
  id: "one",
  published: false,
  type: 2,
  localized,
  videos: [],
  instructors: [],
  certificateId: null,
  priceCredits: "",
  enrollmentEnabled: false,
  createTime: "2026-01-01T00:00:00Z",
  updateTime: "2026-01-01T00:00:00Z",
};
const view = (id = "one") => (
  <CourseEditor
    course={{ ...course, id }}
    loadError={null}
    siteLabel="Global"
    databaseLabel="Fixture"
  />
);
function response(data: unknown = {}) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function render(view: ReactNode, session = "alice") {
  vi.stubGlobal("fetch", (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("user-levels/levels")) {
      return Promise.resolve(response([]));
    }
    return fetchMock(input, init);
  });
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey={session}>{view}</AdminSessionBoundary>)
  );
}
function click(text: string) {
  [...container.querySelectorAll("button")]
    .find((button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === text)!
    .click();
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("excludes rapid saves and competing publication and retains failed drafts", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render(view());
  await act(async () => {
    click("保存");
    click("发布");
    click("保存");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(container.querySelector("[inert]")).not.toBeNull();
  await act(async () => pending.reject(new Error("Save unavailable")));
  expect(container.textContent).toContain("Save unavailable");
  await act(async () => click("保存"));
  expect(router.refresh).toHaveBeenCalledOnce();
});
it("cancels replacement-course saves and suppresses their refreshes", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await act(async () => click("保存"));
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view("two"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(router.refresh).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain("已保存");
});
it("keeps publication failures retryable and rejects abandoned account results", async () => {
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock
    .mockRejectedValueOnce(new Error("Publish unavailable"))
    .mockReturnValueOnce(pending.promise);
  await render(view());
  await act(async () => click("发布"));
  expect(container.textContent).toContain("Publish unavailable");
  await act(async () => {
    click("发布");
    click("保存");
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
  await render(view(), "bob");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(container.textContent).not.toContain("已发布上架");
});
it("blocks duplicate same-slot uploads and saves while an upload is pending", async () => {
  const pending = deferred<{ ok: boolean; json: () => Promise<{ path: string }> }>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render(view());
  const field = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field, "files", {
    configurable: true,
    value: [new File(["image"], "cover.png", { type: "image/png" })],
  });
  await act(async () => {
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    click("保存");
    click("发布");
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () =>
    pending.resolve({ ok: true, json: () => Promise.resolve({ path: "cover-path" }) })
  );
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).localized["zh-CN"].coverUrl).toBe(
    "cover-path"
  );
});
it("saves certificate, fee, and shares on the Java course PUT", async () => {
  fetchMock.mockResolvedValue(response());
  const shareCourse: Course = {
    ...course,
    certificateId: 13,
    priceCredits: "100",
    enrollmentEnabled: true,
    instructors: [
      {
        userId: "15",
        nickName: "Ada",
        avatar: "",
        description: "",
        sharePercent: "50",
      },
    ],
  };
  await render(
    <CourseEditor
      course={shareCourse}
      loadError={null}
      siteLabel="Global"
      databaseLabel="Fixture"
    />
  );
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    type: 2,
    certificateId: 13,
    priceCredits: "100",
    enrollmentEnabled: true,
    instructorUserIds: ["15"],
    instructorShares: [{ userId: "15", shareBps: 5000 }],
  });
});
