import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
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
