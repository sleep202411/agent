// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FailedTile } from "./feed-tiles";
import type { FeedJob } from "./use-generation-feed";
import en from "@/messages/en-US.json";
import zh from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";

const mocks = vi.hoisted(() => ({ copy: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
let container: HTMLDivElement;
let root: Root;
const retry = vi.fn();
const job: FeedJob = {
  localId: "task-123",
  jobId: "task-123",
  modelId: "gemini-omni-flash-preview",
  status: "failed",
  stage: "failed",
  progress: null,
  queuePosition: null,
  etaSeconds: null,
  prompt: "Creator prompt",
  input: {},
  outputs: [],
  createdAtMs: 1,
  errorCode: "VALIDATION_ERROR",
  error: "Reference video could not be decoded. ".repeat(12).trim(),
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.copy.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("opens full failure details, copies identifiers and preserves explicit retry", async () => {
  await act(async () => root.render(<FailedTile job={job} ratio="16 / 9" onRetry={retry} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click("failureDetails.open");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(job.error);
  expect(dialog.textContent).toContain(job.jobId);
  expect(dialog.textContent).toContain(job.modelId);
  expect(dialog.textContent).toContain(job.errorCode);
  await click("failureDetails.copy");
  expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining(job.error!));
  for (const value of [job.jobId, job.modelId, job.errorCode!])
    expect(mocks.copy.mock.calls[0]![0]).toContain(value);
  expect(mocks.success).toHaveBeenCalledWith("failureDetails.copied");
  expect(retry).not.toHaveBeenCalled();
  await click("close");
  await click("retry");
  expect(retry).toHaveBeenCalledTimes(1);
});
it("keeps historical generic failures reportable and supports manual copy after denial", async () => {
  mocks.copy.mockRejectedValue(new Error("Clipboard denied"));
  await act(async () =>
    root.render(
      <FailedTile
        job={{ ...job, error: undefined, errorCode: undefined }}
        ratio="16 / 9"
        onRetry={retry}
      />
    )
  );
  await click("failureDetails.open");
  await click("failureDetails.copy");
  expect(mocks.error).toHaveBeenCalledWith("failureDetails.copyFailed");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(job.jobId);
  expect(dialog.textContent).toContain("generationFailed");
  expect(dialog.textContent).not.toContain("undefined");
  expect(retry).not.toHaveBeenCalled();
});
it.each([en, zh, hk])("provides every failure-detail label in each locale", (messages) => {
  for (const value of Object.values(messages.generation.failureDetails))
    expect(value.trim()).not.toBe("");
  expect(Object.keys(messages.generation.failureDetails)).toEqual(
    Object.keys(en.generation.failureDetails)
  );
});
