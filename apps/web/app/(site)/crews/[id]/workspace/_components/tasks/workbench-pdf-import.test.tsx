import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { WorkbenchPdfImport } from "./workbench-pdf-import";
const state = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  invalidate: vi.fn(),
  user: "user",
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: state.user } }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@/app/(site)/crews/_hooks/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  crewApi: { post: state.post, get: state.get },
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    ((en.crewTaskProject.workbench as Record<string, string>)[key] ?? key).replace(
      /{(\w+)}/g,
      (_, name) => String(values?.[name] ?? name)
    ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const id = "00000000-0000-4000-8000-000000000001";
const preview = {
  id,
  status: "ready",
  tasks: [
    {
      title: "Library",
      description: "Design the scene",
      category: "scenes",
      evidence: "The library doors open",
    },
  ],
  taskIds: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.user = "user";
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<WorkbenchPdfImport crewId="crew" />));
}
async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (item) => item.textContent === label
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
it("requires review before creation and sends selected task indices", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(preview) }))
  );
  state.post.mockResolvedValue({ taskIds: ["task"] });
  await mount();
  const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", {
    value: [new File(["%PDF"], "script.pdf", { type: "application/pdf" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await click("Analyze document");
  expect(host.textContent).toContain("The library doors open");
  expect(state.post).not.toHaveBeenCalled();
  await click("Create 1 tasks");
  expect(state.post).toHaveBeenCalledWith(`/crews/crew/pdf-task-imports/${id}/apply`, {
    body: { indices: [0] },
  });
  expect(host.textContent).toContain("1 tasks created.");
  expect(state.invalidate).toHaveBeenCalledTimes(3);
});
it("recovers an ambiguous submission and retries exactly the same selection", async () => {
  localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id, indices: [0] }));
  state.get.mockResolvedValue(preview);
  state.post
    .mockRejectedValueOnce(new Error("Network disconnected"))
    .mockResolvedValueOnce({ taskIds: ["task"] });
  await mount();
  expect(host.querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled).toBe(true);
  await click("Retry creation");
  expect(host.textContent).toContain("Network disconnected");
  await click("Retry creation");
  expect(state.post.mock.calls[0]).toEqual(state.post.mock.calls[1]);
});
it("does not load another account recovery record", async () => {
  localStorage.setItem("crew-pdf-import:crew:other", JSON.stringify({ id, indices: [0] }));
  await mount();
  expect(state.get).not.toHaveBeenCalled();
});

it("polls a queued analysis and presents its result without another upload", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
    state.get
      .mockResolvedValueOnce({ ...preview, status: "queued", tasks: [] })
      .mockResolvedValue(preview);
    await mount();
    expect(host.textContent).not.toContain("The library doors open");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(host.textContent).toContain("The library doors open");
    expect(state.post).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("retries a transient recovery read without another analysis or creation", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id, indices: [0] }));
    state.get.mockRejectedValueOnce(new Error("Network disconnected")).mockResolvedValue(preview);
    const upload = vi.fn();
    vi.stubGlobal("fetch", upload);
    await mount();
    expect(host.textContent).toContain("Network disconnected");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(host.textContent).toContain("The library doors open");
    expect(host.textContent).not.toContain("Network disconnected");
    expect(host.querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled).toBe(true);
    expect(host.textContent).toContain("Retry creation");
    expect(upload).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it.each([401, 403, 404, 410])(
  "stops recovering a permanently unavailable import (%s)",
  async (status) => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
      state.get.mockRejectedValue(new CrewApiError(status, { message: "Import unavailable" }));
      await mount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6100);
      });
      expect(state.get).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem("crew-pdf-import:crew:user")).toBeNull();
      expect(host.querySelector<HTMLInputElement>("input[type=file]")!.disabled).toBe(false);
      expect(state.post).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }
);
it("cancels recovery on account change and ignores the old response", async () => {
  let complete!: (value: typeof preview) => void;
  localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
  state.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  await mount();
  state.user = "other";
  await mount();
  await act(async () => {
    complete(preview);
  });
  expect(host.textContent).not.toContain("The library doors open");
  expect(state.get).toHaveBeenCalledTimes(1);
});

it("restarts an expired recovered preview without offering a doomed task creation", async () => {
  localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
  state.get.mockResolvedValue({ ...preview, createdAt: "2020-01-01T00:00:00Z" });
  await mount();
  expect(host.textContent).toContain("This preview has expired.");
  expect(host.textContent).not.toContain("Create 1 tasks");
  await click("New analysis");
  expect(localStorage.getItem("crew-pdf-import:crew:user")).toBeNull();
  expect(host.textContent).not.toContain("This preview has expired.");
  expect(state.post).not.toHaveBeenCalled();
});
it("honors server expiry even when the browser clock considers the preview fresh", async () => {
  localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
  state.get.mockResolvedValue({ ...preview, createdAt: new Date().toISOString() });
  state.post.mockRejectedValue(
    new CrewApiError(409, {
      code: "PREVIEW_EXPIRED",
      message: "This preview has expired. Analyze the PDF again.",
    })
  );
  await mount();
  await click("Create 1 tasks");
  expect(host.textContent).not.toContain("Create 1 tasks");
  await click("New analysis");
  expect(localStorage.getItem("crew-pdf-import:crew:user")).toBeNull();
});

it("reports background progress without repeating analysis when its window is hidden", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
    state.get
      .mockResolvedValueOnce({ ...preview, status: "queued", tasks: [] })
      .mockResolvedValue(preview);
    const onStatus = vi.fn();
    await act(async () => root.render(<WorkbenchPdfImport crewId="crew" onStatus={onStatus} />));
    expect(onStatus).toHaveBeenCalledWith("queued");
    host.hidden = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(onStatus).toHaveBeenCalledWith("ready");
    host.hidden = false;
    expect(host.textContent).toContain("The library doors open");
    expect(state.post).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
it("allows documents up to 20 MiB and blocks larger uploads", async () => {
  await mount();
  const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
  for (const size of [20 * 1024 * 1024, 20 * 1024 * 1024 + 1]) {
    const file = new File(["%PDF"], "script.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: size });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Analyze document"
    )!;
    expect(button.disabled).toBe(size > 20 * 1024 * 1024);
  }
});

it("shows persisted analysis failures and their support ID after recovery", async () => {
  localStorage.setItem("crew-pdf-import:crew:user", JSON.stringify({ id }));
  state.get.mockResolvedValue({
    ...preview,
    status: "failed",
    tasks: [],
    failure: {
      code: "provider_limit",
      message: "The AI provider rejected the request because of a rate or quota limit.",
    },
  });
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("rate or quota limit");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(id);
  expect(host.textContent).toContain("New analysis");
  expect(state.post).not.toHaveBeenCalled();
});

it("recovers a lost upload response by polling the same request without creating tasks", async () => {
  vi.useFakeTimers();
  const upload = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", upload);
  state.get
    .mockResolvedValueOnce({ ...preview, status: "queued", tasks: [] })
    .mockResolvedValue(preview);
  try {
    await mount();
    const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
    Object.defineProperty(input, "files", { value: [new File(["fixture"], "script.docx")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await click("Analyze document");
    const url = String(upload.mock.calls[0][0]);
    const requestId = url.split("/").at(-2)!;
    expect(state.get).toHaveBeenCalledWith(`/crews/crew/pdf-task-imports/${requestId}`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(host.textContent).toContain("The library doors open");
    expect(host.textContent).not.toContain("Failed to fetch");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(state.post).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
