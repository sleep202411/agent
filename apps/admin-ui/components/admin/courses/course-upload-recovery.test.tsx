// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { CourseEditor } from "./course-editor";
import { emptyLocalizedCourse, emptyVideoLocalized, type Course } from "./types";
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
  videos: [
    {
      clientKey: "video-one",
      videoKey: "old-video",
      coverUrl: "old-cover",
      sortOrder: 1,
      sectionId: null,
      localized: emptyVideoLocalized(),
    },
  ],
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
    if (String(input).includes("user-levels/levels")) {
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

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = {
    onprogress: null as
      | null
      | ((event: { lengthComputable: boolean; loaded: number; total: number }) => void),
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  responseText = "";
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() {
    FakeXhr.instances.push(this);
  }
}
function transport() {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
}
async function chooseFile(index: number) {
  const field = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[index];
  Object.defineProperty(field, "files", {
    configurable: true,
    value: [new File(["file"], "fixture.mp4", { type: "video/mp4" })],
  });
  await act(async () => field.dispatchEvent(new Event("change", { bubbles: true })));
}
function signed() {
  return response({
    uploadUrl: "https://storage.invalid/video",
    method: "PUT",
    headers: { "content-type": "video/custom" },
    path: "new-video",
  });
}
it("aborts active video transport after account replacement and ignores retained progress", async () => {
  transport();
  fetchMock.mockResolvedValue(signed());
  await render(view());
  await chooseFile(1);
  const xhr = FakeXhr.instances[0];
  const progress = xhr.upload.onprogress!;
  await render(view(), "bob");
  expect(xhr.abort).toHaveBeenCalledOnce();
  expect(xhr.upload.onprogress).toBeNull();
  await act(async () => progress({ lengthComputable: true, loaded: 80, total: 100 }));
  expect(container.textContent).not.toContain("80%");
});
it("uses the provider content type once and attaches a completed video", async () => {
  transport();
  fetchMock.mockResolvedValueOnce(signed()).mockResolvedValue(response());
  await render(view());
  await chooseFile(1);
  const xhr = FakeXhr.instances[0];
  expect(
    xhr.setRequestHeader.mock.calls.filter((call) => call[0].toLowerCase() === "content-type")
  ).toEqual([["content-type", "video/custom"]]);
  await act(async () => xhr.onload?.());
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).videos[0].videoKey).toBe("new-video");
});
it("stops URL lookup after the editor changes without starting XHR", async () => {
  transport();
  const pending = deferred<ReturnType<typeof response>>();
  fetchMock.mockReturnValue(pending.promise);
  await render(view());
  await chooseFile(1);
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render(view("two"));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(signed()));
  expect(FakeXhr.instances).toHaveLength(0);
});
it("cancels a removed video's upload and releases save admission", async () => {
  transport();
  fetchMock.mockResolvedValueOnce(signed()).mockResolvedValue(response());
  await render(view());
  await chooseFile(1);
  const remove = container.querySelector('button svg[class*="icon-trash"]')?.closest("button");
  expect(remove).not.toBeNull();
  await act(async () => remove!.click());
  expect(FakeXhr.instances[0].abort).toHaveBeenCalledOnce();
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).videos).toEqual([]);
});
it("preserves a newer manual cover path when an earlier upload finishes", async () => {
  const pending = deferred<{ ok: boolean; json: () => Promise<{ path: string }> }>();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render(view());
  await chooseFile(0);
  const field = container.querySelector<HTMLInputElement>(
    'input[placeholder="封面 URL / OSS path"]'
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      field,
      "manual-cover"
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    pending.resolve({ ok: true, json: () => Promise.resolve({ path: "old-upload" }) })
  );
  expect(field.value).toBe("manual-cover");
  await act(async () => click("保存"));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).localized["zh-CN"].coverUrl).toBe(
    "manual-cover"
  );
});
