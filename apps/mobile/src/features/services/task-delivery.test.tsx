import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskDelivery } from "./task-delivery";
import type { TaskSubmission } from "./task-delivery-api";
const h = vi.hoisted(() => ({ fetch: vi.fn(), generation: 1, file: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("./task-delivery-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-delivery-api")>()),
  fetchTaskDeliveryTemplate: h.fetch,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./user-displays", () => ({
  useUserDisplays: () =>
    new Map([
      ["1", { nickname: "Artist" }],
      ["2", { nickname: "Reviewer" }],
    ]),
}));
vi.mock("./conversation-file", () => ({
  ConversationFile: (p: { name: string }) => {
    h.file(p);
    return <span>file:{p.name}</span>;
  },
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (s: string) => s, useLocale: () => "en-US" }));
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const template = {
  categoryId: "category",
  version: 2,
  definition: {
    name: "Final film",
    description: "Deliver masters",
    prices: [{ currency: "USD" as const, amountMinor: "12345", unit: "film" }],
    fields: [
      {
        key: "notes",
        label: "Notes",
        instructions: "Explain changes",
        required: true,
        type: "text" as const,
      },
      {
        key: "video",
        label: "Video",
        instructions: "",
        required: true,
        type: "attachment" as const,
      },
    ],
  },
};
const submission: TaskSubmission = {
  id: "submission",
  versionNumber: 1,
  submittedByUserId: "1",
  note: "Delivered",
  professionalDelivery: { ...template, answers: { notes: "Cleaned audio", video: ["asset"] } },
  canvasVersionId: "snapshot",
  productionVersionId: null,
  reviewNote: "Looks good",
  reviewedByUserId: "2",
  reviewedAt: "2026-09-29T00:00:00Z",
  mergedAt: null,
  createdAt: "2026-09-29T00:00:00Z",
  assets: [
    {
      id: "asset",
      name: "Master.mp4",
      mediaAssetId: "media",
      contentType: "video/mp4",
      sizeBytes: 123,
    },
  ],
};
let root: Root, host: HTMLDivElement;
const render = (submissions = [submission]) =>
  act(async () =>
    root.render(<TaskDelivery taskId="task" generation={1} submissions={submissions} />)
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.fetch.mockResolvedValue(template);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("shows requirements, immutable answers, authorized files and review context", async () => {
  await render();
  for (const text of [
    "Deliver masters",
    "Notes",
    "Explain changes",
    "123.45",
    "Cleaned audio",
    "Master.mp4",
    "Reviewer",
    "Looks good",
    "taskDelivery.snapshot",
  ])
    expect(host.textContent).toContain(text);
  expect(h.file).toHaveBeenCalledWith({
    mediaAssetId: "media",
    name: "Master.mp4",
    contentType: "video/mp4",
  });
});
it("orders versions newest first and does not open unavailable media", async () => {
  await render([
    submission,
    {
      ...submission,
      id: "new",
      versionNumber: 2,
      note: "Newest",
      assets: [{ ...submission.assets[0]!, name: "Lost", mediaAssetId: null }],
    },
  ]);
  expect(host.textContent!.indexOf("Newest")).toBeLessThan(host.textContent!.indexOf("Delivered"));
  expect(host.textContent).toContain("Lost · taskActivity.unavailable");
  expect(h.file.mock.calls.every(([p]) => p.name !== "Lost")).toBe(true);
});
it("keeps errors distinct from missing templates and retries", async () => {
  h.fetch.mockRejectedValueOnce(new Error("Forbidden")).mockResolvedValueOnce(null);
  await render([]);
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("taskDelivery.noTemplate");
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("taskDelivery.noTemplate");
  expect(host.textContent).toContain("taskDelivery.noSubmissions");
});
it("aborts on leaving and suppresses late results from another account", async () => {
  let finish!: (v: unknown) => void;
  h.fetch.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render([]);
  const signal = h.fetch.mock.calls[0][1];
  h.generation = 2;
  await act(async () => finish(template));
  expect(host.textContent).not.toContain("Final film");
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
