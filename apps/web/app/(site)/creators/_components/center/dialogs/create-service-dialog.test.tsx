// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { CreatorServiceDTO } from "@repo/shared/creator-service";
import { CreateServiceDialog } from "./create-service-dialog";
const mocks = vi.hoisted(() => ({
  account: "alice",
  cell: "global",
  create: vi.fn(),
  update: vi.fn(),
  publish: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/lib/region/cell", () => ({
  get CURRENT_CELL() {
    return mocks.cell;
  },
}));
vi.mock("@/src/env", () => ({
  env: { BANNER_BASE_URL: "https://fixture.oss-ap-southeast-1.aliyuncs.com" },
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: mocks.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/app/(site)/creators/_hooks/use-creator-services", async (original) => ({
  ...(await original<typeof import("@/app/(site)/creators/_hooks/use-creator-services")>()),
  useCreateService: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateService: () => ({ mutateAsync: mocks.update, isPending: false }),
  usePublishService: () => ({ mutateAsync: mocks.publish, isPending: false }),
}));
vi.mock("@/components/ui/dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Wrap,
    DialogBody: Wrap,
    DialogContent: Wrap,
    DialogFooter: Wrap,
    DialogHero: () => null,
  };
});
vi.mock("./service-detail-sections", () => ({ ServiceDetailSections: () => <div>Preview</div> }));
const service: CreatorServiceDTO = {
  id: "service-1",
  creatorId: "alice",
  title: "Service",
  summary: "Fixture",
  coverPath: "",
  category: "other",
  tags: [],
  status: "draft",
  publishedAt: null,
  createdAt: "2026-09-15T00:00:00Z",
  updatedAt: "2026-09-15T00:00:00Z",
  version: 1,
  packages: [
    {
      id: "package",
      tier: "basic",
      title: "Basic",
      description: "Fixture",
      price: 10,
      currency: "USD",
      deliveryDays: 1,
      revisions: 1,
      scope: [],
    },
  ],
  requirementQuestions: [],
};
let root: Root, container: HTMLDivElement;
const close = vi.fn(),
  saved = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "alice";
  mocks.cell = "global";
  mocks.create.mockResolvedValue({ ...service, version: 2 });
  mocks.update.mockResolvedValue({ ...service, version: 2 });
  mocks.publish.mockResolvedValue({ ...service, status: "listed", version: 3 });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (initial: CreatorServiceDTO | null = service, open = true) =>
  root.render(
    <CreateServiceDialog initial={initial} open={open} onOpenChange={close} onSaved={saved} />
  );
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label
  )!;
async function preview() {
  for (let i = 0; i < 3; i++) await act(async () => button("wizardNext").click());
}
async function fill(placeholder: string, value: string, index = 0) {
  await act(async () => {
    const input = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      `[placeholder="${placeholder}"]`
    )[index]!;
    const proto =
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["account", "service", "close", "unmount", "active"])(
  "owns save-to-publish continuation after %s",
  async (mode) => {
    let finish!: (result: CreatorServiceDTO) => void;
    mocks.update.mockReturnValueOnce(
      new Promise<CreatorServiceDTO>((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => render());
    await preview();
    await act(async () => {
      button("savePublish").click();
      button("savePublish").click();
    });
    expect(mocks.update).toHaveBeenCalledOnce();
    await act(async () => {
      if (mode === "account") {
        mocks.account = "bob";
        render();
      }
      if (mode === "service") render({ ...service, id: "service-2" });
      if (mode === "close") render(service, false);
      if (mode === "unmount") root.render(null);
    });
    await act(async () => finish({ ...service, version: 2 }));
    expect(mocks.publish).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(saved).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(close).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(mocks.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
  }
);
it("preserves local edits and original version after background refresh", async () => {
  await act(async () => render());
  await fill("fieldTitlePlaceholder", "Unsaved title");
  await act(async () => render({ ...service, title: "Background title", version: 9 }));
  expect(
    container.querySelector<HTMLInputElement>('[placeholder="fieldTitlePlaceholder"]')!.value
  ).toBe("Unsaved title");
  await act(async () => button("saveDraft").click());
  expect(mocks.update.mock.calls[0]![0]).toMatchObject({
    id: service.id,
    body: { title: "Unsaved title", expectedVersion: 1 },
  });
});
it("blocks duplicate creates and saves the next edit to the confirmed row", async () => {
  let finish!: (result: CreatorServiceDTO) => void;
  mocks.create.mockReturnValueOnce(
    new Promise<CreatorServiceDTO>((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => render(null));
  await fill("fieldTitlePlaceholder", "Title");
  await fill("fieldSummaryPlaceholder", "Summary");
  await act(async () => {
    button("saveDraft").click();
    button("saveDraft").click();
  });
  expect(mocks.create).toHaveBeenCalledOnce();
  await act(async () => finish({ ...service, version: 2 }));
  await act(async () => button("saveDraft").click());
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.update.mock.calls[0]![0]).toMatchObject({
    id: service.id,
    body: { expectedVersion: 2 },
  });
});
it("retains the saved version for retry after publish failure", async () => {
  mocks.publish.mockRejectedValueOnce(new Error("Unavailable"));
  await act(async () => render());
  await preview();
  await act(async () => button("savePublish").click());
  expect(close).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledOnce();
  await act(async () => button("savePublish").click());
  expect(mocks.update.mock.calls[1]![0].body.expectedVersion).toBe(2);
  expect(close).toHaveBeenCalledOnce();
});
it("ignores an abandoned publish completion", async () => {
  let finish!: (result: CreatorServiceDTO) => void;
  mocks.publish.mockReturnValueOnce(
    new Promise<CreatorServiceDTO>((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => render());
  await preview();
  await act(async () => button("savePublish").click());
  await act(async () => {
    mocks.account = "bob";
    render(null);
  });
  await act(async () => finish({ ...service, status: "listed" }));
  expect(close).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});

it.each(["", "-1", "100000001", "1e309"])(
  "rejects invalid package price %s without saving a free offer",
  async (price) => {
    await act(async () => render());
    await act(async () => button("wizardNext").click());
    await fill("0", price);
    await act(async () => button("saveDraft").click());
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("tierInvalidNumber");
    expect(button("wizardNext").disabled).toBe(true);
  }
);
it.each([365, 200])("rejects fractional package fields with max=%s", async (max) => {
  await act(async () => render());
  await act(async () => button("wizardNext").click());
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(`input[max="${max}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1.5");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("saveDraft").click());
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith("tierInvalidNumber");
});
it("accepts an explicitly entered zero price", async () => {
  await act(async () => render());
  await act(async () => button("wizardNext").click());
  await fill("0", "0");
  await act(async () => button("saveDraft").click());
  expect(mocks.update.mock.calls[0]![0].body.packages[0].price).toBe(0);
  expect(button("wizardNext").disabled).toBe(false);
});
it.each([
  ["global", "USD"],
  ["com", "USD"],
  ["cn", "CNY"],
])("uses %s currency policy independently of OSS host", async (cell, expectedCurrency) => {
  mocks.cell = cell!;
  await act(async () => render(null));
  await fill("fieldTitlePlaceholder", "Service");
  await fill("fieldSummaryPlaceholder", "Summary");
  await act(async () => button("wizardNext").click());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="tier.basic"]')!.click()
  );
  await fill("tierTitlePlaceholder.basic", "Basic");
  await fill("tierDescPlaceholder.basic", "Description");
  await fill("0", "10");
  await act(async () => button("saveDraft").click());
  expect(mocks.create.mock.calls[0]![0].packages[0].currency).toBe(expectedCurrency);
});

async function questionsStep() {
  await act(async () => render());
  await act(async () => button("wizardNext").click());
  await act(async () => button("wizardNext").click());
  await act(async () => button("+ questionAddFirst").click());
}
const confirmedQuestions = [
  { id: "saved-first", prompt: "First", helpText: "", required: false, displayOrder: 0 },
  { id: "saved-second", prompt: "Second", helpText: "", required: false, displayOrder: 1 },
];
it("keeps confirmed question IDs through pending edits and reordering without remounting rows", async () => {
  let finish!: (result: CreatorServiceDTO) => void;
  mocks.update.mockReturnValueOnce(
    new Promise<CreatorServiceDTO>((resolve) => {
      finish = resolve;
    })
  );
  await questionsStep();
  await fill("questionPromptPlaceholder", "First");
  await act(async () => button("+ questionAdd").click());
  await fill("questionPromptPlaceholder", "Second", 1);
  await act(async () => button("saveDraft").click());
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="questionMoveDown"]')!.click()
  );
  await fill("questionPromptPlaceholder", "Second edited");
  const input = container.querySelector('[placeholder="questionPromptPlaceholder"]');
  await act(async () =>
    finish({ ...service, version: 2, requirementQuestions: [...confirmedQuestions].reverse() })
  );
  expect(container.querySelector('[placeholder="questionPromptPlaceholder"]')).toBe(input);
  await act(async () => button("saveDraft").click());
  expect(mocks.update.mock.calls[1]![0].body.requirementQuestions).toEqual([
    { ...confirmedQuestions[1], prompt: "Second edited", displayOrder: 0 },
    { ...confirmedQuestions[0], displayOrder: 1 },
  ]);
});
it("does not restore deleted questions or assign their IDs to newly added rows", async () => {
  let finish!: (result: CreatorServiceDTO) => void;
  mocks.update.mockReturnValueOnce(
    new Promise<CreatorServiceDTO>((resolve) => {
      finish = resolve;
    })
  );
  await questionsStep();
  await fill("questionPromptPlaceholder", "First");
  await act(async () => button("saveDraft").click());
  await act(async () => button("questionRemove").click());
  await act(async () => button("+ questionAddFirst").click());
  await fill("questionPromptPlaceholder", "Replacement");
  await act(async () =>
    finish({ ...service, version: 2, requirementQuestions: [confirmedQuestions[0]!] })
  );
  await act(async () => button("saveDraft").click());
  expect(mocks.update.mock.calls[1]![0].body.requirementQuestions).toEqual([
    { prompt: "Replacement", helpText: "", required: false, displayOrder: 0 },
  ]);
});
it("matches confirmation by original display order when blank questions were omitted", async () => {
  let finish!: (result: CreatorServiceDTO) => void;
  mocks.update.mockReturnValueOnce(
    new Promise<CreatorServiceDTO>((resolve) => {
      finish = resolve;
    })
  );
  await questionsStep();
  await act(async () => button("+ questionAdd").click());
  await fill("questionPromptPlaceholder", "Second", 1);
  await act(async () => button("saveDraft").click());
  expect(mocks.update.mock.calls[0]![0].body.requirementQuestions).toHaveLength(1);
  await act(async () =>
    finish({ ...service, version: 2, requirementQuestions: [confirmedQuestions[1]!] })
  );
  await act(async () => button("saveDraft").click());
  expect(mocks.update.mock.calls[1]![0].body.requirementQuestions[0]).toMatchObject({
    id: "saved-second",
    displayOrder: 1,
  });
});

it("retries first creation with the same original request after a lost response", async () => {
  mocks.create
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ ...service, version: 0 });
  await act(async () => render(null));
  await fill("fieldTitlePlaceholder", "Title");
  await fill("fieldSummaryPlaceholder", "Summary");
  await act(async () => button("saveDraft").click());
  await act(async () => button("saveDraft").click());
  expect(mocks.create.mock.calls[1]![0]).toEqual(mocks.create.mock.calls[0]![0]);
  expect(mocks.create.mock.calls[0]![0].clientRequestKey).toEqual(expect.any(String));
  expect(mocks.update).not.toHaveBeenCalled();
});
it("recovers first creation before applying edits and retains the row after patch failure", async () => {
  mocks.create
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ ...service, version: 0 });
  mocks.update
    .mockRejectedValueOnce(new Error("Patch unavailable"))
    .mockResolvedValueOnce({ ...service, version: 1 });
  await act(async () => render(null));
  await fill("fieldTitlePlaceholder", "Original title");
  await fill("fieldSummaryPlaceholder", "Summary");
  await act(async () => button("saveDraft").click());
  await fill("fieldTitlePlaceholder", "Edited title");
  await act(async () => button("saveDraft").click());
  expect(mocks.create.mock.calls[1]![0]).toEqual(mocks.create.mock.calls[0]![0]);
  expect(mocks.update.mock.calls[0]![0]).toMatchObject({
    id: service.id,
    body: { title: "Edited title", expectedVersion: 0 },
  });
  await act(async () => button("saveDraft").click());
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.update).toHaveBeenCalledTimes(2);
});
it("abandons the recovery-to-edit continuation after account replacement", async () => {
  mocks.create.mockRejectedValueOnce(new Error("Response lost"));
  let finish!: (result: CreatorServiceDTO) => void;
  await act(async () => render(null));
  await fill("fieldTitlePlaceholder", "Title");
  await fill("fieldSummaryPlaceholder", "Summary");
  await act(async () => button("saveDraft").click());
  await fill("fieldTitlePlaceholder", "Edited title");
  mocks.create.mockReturnValueOnce(
    new Promise<CreatorServiceDTO>((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => button("saveDraft").click());
  await act(async () => {
    mocks.account = "bob";
    render(null);
  });
  await act(async () => finish({ ...service, version: 0 }));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
