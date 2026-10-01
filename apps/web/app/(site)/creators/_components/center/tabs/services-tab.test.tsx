// @vitest-environment jsdom
import { act, type ReactNode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { ServicesTab } from "./services-tab";
const mocks = vi.hoisted(() => ({
  account: "alice",
  listError: null as { status: number; message: string } | null,
  nextPageError: false,
  refetch: vi.fn(),
  status: "draft",
  publish: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  archive: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: mocks.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("../dialogs/create-service-dialog", () => ({ CreateServiceDialog: () => null }));
vi.mock("../dialogs/service-detail-dialog", () => ({ ServiceDetailDialog: () => null }));
vi.mock("@/app/(site)/creators/_hooks/use-creator-services", () => ({
  useCreatorServices: () => ({
    isLoading: false,
    error: mocks.listError,
    isFetchNextPageError: mocks.nextPageError,
    refetch: mocks.refetch,
    data: {
      items: [
        {
          id: "service-1",
          creatorId: "alice",
          title: "Fixture",
          summary: "Service",
          coverPath: "",
          category: "other",
          tags: [],
          startingPrice: 10,
          currency: "USD",
          startingDeliveryDays: 1,
          packageCount: 1,
        },
      ],
      hasMore: false,
    },
  }),
  useCreatorService: () => ({ data: { status: mocks.status } }),
  usePublishService: () => ({ mutateAsync: mocks.publish, isPending: false }),
  usePauseService: () => ({ mutateAsync: mocks.pause, isPending: false }),
  useResumeService: () => ({ mutateAsync: mocks.resume, isPending: false }),
  useArchiveService: () => ({ mutateAsync: mocks.archive, isPending: false }),
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const Wrap = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  const Action = ({ children, onClick, disabled }: ComponentProps<"button">) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
  return {
    AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
      open ? <div>{children}</div> : null,
    AlertDialogAction: Action,
    AlertDialogCancel: Action,
    AlertDialogContent: Wrap,
    AlertDialogDescription: Wrap,
    AlertDialogFooter: Wrap,
    AlertDialogHeader: Wrap,
    AlertDialogTitle: Wrap,
  };
});
const creator: Creator = {
  id: "alice",
  name: "Alice",
  avatar: "",
  banner: "",
  bio: "",
  joinedAt: "",
  levels: [],
  contact: "",
  study: "",
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "alice";
  mocks.listError = null;
  mocks.nextPageError = false;
  mocks.status = "draft";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (owner = true, creatorId = "alice") =>
  root.render(<ServicesTab creator={{ ...creator, id: creatorId }} isOwner={owner} />);
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label
  )!;
it.each([
  ["publish", "draft", "actionPublish"],
  ["pause", "listed", "actionPause"],
  ["resume", "paused", "actionResume"],
] as const)(
  "prevents rapid duplicate %s and ignores abandoned feedback",
  async (kind, status, label) => {
    mocks.status = status;
    let finish!: () => void;
    mocks[kind].mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => render());
    await act(async () => {
      button(label).click();
      button(label).click();
    });
    expect(mocks[kind]).toHaveBeenCalledOnce();
    await act(async () => {
      mocks.account = "bob";
      render(false);
    });
    await act(async () => finish());
    expect(mocks.success).not.toHaveBeenCalled();
  }
);
it.each(["account", "creator", "authority", "active"])(
  "owns archive confirmation across %s changes",
  async (mode) => {
    let finish!: () => void;
    mocks.archive.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    await act(async () => render());
    await act(async () => button("actionArchive").click());
    await act(async () => {
      button("archiveConfirmAction").click();
      button("archiveConfirmAction").click();
    });
    expect(mocks.archive).toHaveBeenCalledOnce();
    await act(async () => {
      if (mode === "account") {
        mocks.account = "bob";
        render();
      }
      if (mode === "creator") render(true, "creator-2");
      if (mode === "authority") render(false);
    });
    await act(async () => finish());
    expect(mocks.success).toHaveBeenCalledTimes(mode === "active" ? 1 : 0);
    expect(button("archiveConfirmAction")).toBeUndefined();
  }
);
it("retains failed archive confirmation for retry", async () => {
  mocks.archive.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(undefined);
  await act(async () => render());
  await act(async () => button("actionArchive").click());
  await act(async () => button("archiveConfirmAction").click());
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(button("archiveConfirmAction")).toBeDefined();
  await act(async () => button("archiveConfirmAction").click());
  expect(mocks.archive).toHaveBeenCalledTimes(2);
  expect(mocks.success).toHaveBeenCalledOnce();
});
it("releases a failed card transition for an active retry", async () => {
  mocks.publish.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(undefined);
  await act(async () => render());
  await act(async () => button("actionPublish").click());
  await act(async () => button("actionPublish").click());
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(mocks.success).toHaveBeenCalledOnce();
});

it("clears cached offerings on denied pagination and retries explicitly", async () => {
  await act(async () => render(false));
  expect(container.textContent).toContain("Fixture");
  mocks.listError = { status: 403, message: "Access removed" };
  mocks.nextPageError = true;
  await act(async () => render(false));
  expect(container.textContent).not.toContain("Fixture");
  expect(container.querySelector("[role=alert]")?.textContent).toBe("Access removed");
  await act(async () => button("retryLoad").click());
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("retains earlier public cards on a transient next-page error", async () => {
  mocks.listError = { status: 503, message: "Try again" };
  mocks.nextPageError = true;
  await act(async () => render(false));
  expect(container.textContent).toContain("Fixture");
  expect(container.querySelector("[role=alert]")?.textContent).toBe("Try again");
});
