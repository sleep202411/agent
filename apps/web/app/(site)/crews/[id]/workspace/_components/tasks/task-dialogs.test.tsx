import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewTaskDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { SubmitTaskDialog } from "./task-dialogs";

const submit = vi.hoisted(() => vi.fn());
const delivery = vi.hoisted(() => ({
  data: null as import("@/app/(site)/crews/_hooks/types").CrewDeliveryTemplateDTO | null,
}));
const assetQuery = vi.hoisted(() => ({
  data: { items: [{ id: "asset-1", name: "Output" }] },
  isLoading: false,
  isFetching: false,
  error: null as Error | null,
  refetch: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  fetchNextPage: vi.fn(),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useSubmitCrewTask: () => ({ mutateAsync: submit, isPending: false }),
}));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssetFolders: () => ({ data: [] }),
  useCrewAssets: () => assetQuery,
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./task-delivery-upload", () => ({ TaskDeliveryUpload: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
const onSubmitted = vi.fn();
const onOpenChange = vi.fn();
function render(taskId: string, open = true, extra: Partial<CrewTaskDTO> = {}) {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root!.render(
      <SubmitTaskDialog
        open={open}
        crewId="crew-1"
        task={{ id: taskId, ...extra } as CrewTaskDTO}
        onSubmitted={onSubmitted}
        onOpenChange={onOpenChange}
      />
    )
  );
  act(() => fillLink("https://example.com/delivery"));
}
function fillLink(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="deliveryLink"]');
  if (!input) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function clickSubmit() {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "submit")!.click();
}
function fill(value: string) {
  const input = document.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  vi.resetAllMocks();
  delivery.data = null;
  assetQuery.error = null;
  assetQuery.isLoading = false;
  assetQuery.hasNextPage = false;
  assetQuery.isFetchingNextPage = false;
  assetQuery.isFetchNextPageError = false;
  assetQuery.data = { items: [{ id: "asset-1", name: "Output" }] };
});

it("does not close a new submission dialog when an earlier request completes", async () => {
  let resolve!: (value: unknown) => void;
  submit.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render("task-1");
  act(clickSubmit);
  render("task-1", false);
  render("task-2");
  act(() => fill("Second task notes"));
  await act(async () => resolve({ id: "task-1" }));
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(document.querySelector("textarea")!.value).toBe("Second task notes");
});

it("clears the previous task's notes when the selected task changes", () => {
  render("task-1");
  act(() => fill("Only belongs to task one"));
  render("task-2");
  expect(document.querySelector("textarea")!.value).toBe("");
});

it("submits only once for repeated clicks before the pending render", async () => {
  let resolve!: (value: unknown) => void;
  submit.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render("task-1");
  act(() => {
    clickSubmit();
    clickSubmit();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: "task-1" }));
  expect(onSubmitted).toHaveBeenCalledWith("task-1");
});

it("retains notes and permits retry after a failed submission", async () => {
  submit
    .mockRejectedValueOnce(new Error("Temporary failure"))
    .mockResolvedValueOnce({ id: "task-1" });
  render("task-1");
  act(() => fill("Keep these notes"));
  await act(async () => clickSubmit());
  expect(document.querySelector("textarea")!.value).toBe("Keep these notes");
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledTimes(2);
  expect(onSubmitted).toHaveBeenCalledTimes(1);
});

it("locks the submitted draft and restores editing after failure", async () => {
  let reject!: (error: Error) => void;
  submit.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    })
  );
  render("task-1");
  act(() => fill("Review this output"));
  act(() => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  act(clickSubmit);
  expect(document.querySelector("textarea")!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.disabled).toBe(true);
  expect(submit).toHaveBeenCalledWith({
    taskId: "task-1",
    note: "https://example.com/delivery\n\nReview this output",
    assetNodeIds: ["asset-1"],
  });
  await act(async () => reject(new Error("Please retry")));
  expect(document.querySelector("textarea")!.disabled).toBe(false);
  expect(document.querySelector("textarea")!.value).toBe("Review this output");
  expect(document.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
});

it("distinguishes asset loading from an empty result", () => {
  assetQuery.isLoading = true;
  assetQuery.data = { items: [] };
  render("task-1");
  expect(document.body.textContent).toContain("loading");
  expect(document.body.textContent).not.toContain("noRecentAssets");
});
it("keeps loaded attachments and exposes a failed refresh for retry", async () => {
  assetQuery.error = new Error("Asset service unavailable");
  render("task-1");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Asset service unavailable"
  );
  expect(document.body.textContent).toContain("Output");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "retry")!
      .click()
  );
  expect(assetQuery.refetch).toHaveBeenCalledTimes(1);
});

vi.mock("./task-delivery-template", async (original) => ({
  ...(await original<typeof import("./task-delivery-template")>()),
  useTaskDeliveryTemplate: () => ({ data: delivery.data, isPending: false, isError: false }),
}));

it("loads and submits attachments beyond the first page without losing earlier selections", async () => {
  assetQuery.hasNextPage = true;
  render("task-1");
  act(() => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  const more = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "loadMore"
  );
  expect(more).toBeDefined();
  await act(async () => more!.click());
  expect(assetQuery.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false });
  assetQuery.data = {
    items: [
      { id: "asset-1", name: "Output" },
      { id: "asset-101", name: "Older output" },
    ],
  };
  assetQuery.hasNextPage = false;
  render("task-1");
  expect(document.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
  act(() => document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[1]!.click());
  submit.mockResolvedValue({ id: "task-1" });
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledWith({
    taskId: "task-1",
    note: "https://example.com/delivery",
    assetNodeIds: ["asset-1", "asset-101"],
  });
});

it("retries the failed asset page and keeps the selected attachments", async () => {
  render("task-1");
  act(() => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  assetQuery.hasNextPage = true;
  assetQuery.isFetchNextPageError = true;
  assetQuery.error = new Error("Next page unavailable");
  render("task-1");
  expect(document.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
  await act(async () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "retry")!.click()
  );
  expect(assetQuery.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false });
  expect(assetQuery.refetch).not.toHaveBeenCalled();
});
it("disables loading more attachments while a request is in flight", () => {
  assetQuery.hasNextPage = true;
  assetQuery.isFetching = true;
  assetQuery.isFetchingNextPage = true;
  render("task-1");
  const more = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "loading"
  )!;
  expect(more.disabled).toBe(true);
  assetQuery.isFetching = false;
});

it("restarts expired asset pagination without losing the delivery draft", async () => {
  render("task-1");
  act(() => {
    fill("Delivery draft");
    document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click();
  });
  assetQuery.hasNextPage = true;
  assetQuery.isFetchNextPageError = true;
  assetQuery.error = new CrewApiError(400, {
    code: "CREW_ASSET_CURSOR_INVALID",
    message: "Restart assets",
  });
  render("task-1");
  await act(async () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "retry")!.click()
  );
  expect(assetQuery.refetch).toHaveBeenCalledTimes(1);
  expect(assetQuery.fetchNextPage).not.toHaveBeenCalled();
  expect(document.querySelector("textarea")!.value).toBe("Delivery draft");
  expect(document.querySelector('[role="checkbox"]')!.getAttribute("aria-checked")).toBe("true");
});

it("requires nonblank text and a still-attached file, preserving answers after validation failures", async () => {
  delivery.data = {
    categoryId: "cat",
    version: 1,
    definition: {
      name: "Delivery",
      fields: [
        { key: "summary", instructions: "", label: "Summary", type: "text", required: true },
        { key: "files", instructions: "", label: "Files", type: "attachment", required: true },
        { key: "extra", instructions: "", label: "Optional", type: "text", required: false },
      ],
    },
  };
  render("task-1");
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("missingRequiredFields");
  const answer = (text: string) => {
    const input = document.querySelector('textarea[aria-label="Summary"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  act(() => answer("   "));
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  act(() => answer("Complete storyboard"));
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  act(() => document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  const picker = () =>
    document.querySelector<HTMLButtonElement>(
      'section[aria-label="attachAssets"] [role="checkbox"]'
    )!;
  const field = () => document.querySelector<HTMLButtonElement>('section [role="checkbox"]')!;
  act(() => field().click());
  act(() => picker().click()); // Removing the file invalidates its required answer.
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  act(() => picker().click());
  submit.mockResolvedValue({ id: "task-1" });
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      assetNodeIds: ["asset-1"],
      professionalDelivery: {
        categoryId: "cat",
        version: 1,
        answers: { summary: "Complete storyboard", files: ["asset-1"] },
      },
    })
  );
});

it("shows default delivery slots and persists the link with the submission note", async () => {
  submit.mockResolvedValue({ id: "task-1" });
  render("task-1");
  for (const label of ["subtitledVideo", "cleanVideo", "subtitleFile", "sourceFiles"])
    expect(document.body.textContent).toContain(label);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="deliveryLink"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "https://example.com/delivery"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fill("Final cut");
  });
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ note: "https://example.com/delivery\n\nFinal cut" })
  );
});

it("explains missing and invalid links instead of silently disabling submission", async () => {
  render("task-1");
  act(() => fillLink(""));
  expect(document.body.textContent).toContain("deliveryLinkRequired");
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  act(() => fillLink("test"));
  expect(document.body.textContent).toContain("deliveryLinkInvalid");
  expect(document.querySelector('[aria-label="deliveryLink"]')?.getAttribute("aria-invalid")).toBe(
    "true"
  );
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  act(() => fillLink("https://example.com/final"));
  submit.mockResolvedValue({ id: "task-1" });
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ note: "https://example.com/final" })
  );
});

it("submits attached files without requiring a duplicate delivery link and uses the automatic folder", async () => {
  render("task-1");
  act(() => fillLink(""));
  expect(document.querySelector("details")).toBeNull();
  expect(document.querySelector('[aria-label="deliveryFolder"]')).toBeNull();
  expect(document.body.textContent).toContain("automaticDeliveryFolder");
  act(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="attachAssets"] [role="checkbox"]')!
      .click()
  );
  expect(document.body.textContent).not.toContain("deliveryLinkRequired");
  submit.mockResolvedValue({ id: "task-1" });
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledWith({ taskId: "task-1", note: "", assetNodeIds: ["asset-1"] });
});

it("requires delivery again after the last attachment is removed and rejects malformed optional links", () => {
  render("task-1");
  act(() => fillLink(""));
  const pick = () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="attachAssets"] [role="checkbox"]')!
      .click();
  act(pick);
  act(() => fillLink("invalid"));
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("deliveryLinkInvalid");
  act(() => fillLink(""));
  act(pick);
  expect(document.body.textContent).toContain("deliveryLinkRequired");
  act(clickSubmit);
  expect(submit).not.toHaveBeenCalled();
});

it("allows the linked canvas as delivery and shows the existing task destination", async () => {
  render("task-1", true, {
    canvasHref: "/studio/canvas/task-1",
    deliveryFolder: { id: "folder-1", name: "Script / Task one" },
  });
  act(() => fillLink(""));
  expect(document.body.textContent).toContain("Script / Task one");
  expect(document.body.textContent).not.toContain("deliveryLinkRequired");
  submit.mockResolvedValue({ id: "task-1" });
  await act(async () => clickSubmit());
  expect(submit).toHaveBeenCalledWith({ taskId: "task-1", note: "", assetNodeIds: [] });
});
