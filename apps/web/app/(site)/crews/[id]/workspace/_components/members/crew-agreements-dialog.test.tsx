import { CrewApiError as CursorApiError } from "@/app/(site)/crews/_hooks/api";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cursorError: false,
  failed: true,
  loaded: false,
  nextPageError: true,
  fetching: false,
  next: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "alice" } }) }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogBody: Part,
    DialogContent: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => {
  const mutation = () => ({ isPending: false, mutate: vi.fn() });
  return {
    useCrewAgreements: () => ({
      data: {
        items: state.loaded
          ? [
              {
                id: "loaded",
                title: "Loaded agreement",
                signerName: "Signer",
                signerEmail: "signer@example.com",
                status: "completed",
                capabilities: { sign: false },
                delivery: { status: "completed", canRetry: false },
                archive: { status: "pending", canRetry: false },
              },
            ]
          : [],
        capabilities: { create: false },
        summary: {},
      },
      isLoading: false,
      isError: state.failed,
      isFetchNextPageError: state.failed && state.nextPageError,
      isFetching: state.fetching,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: state.next,
      refetch: state.refetch,
      error: state.cursorError
        ? new CursorApiError(400, { code: "CREW_AGREEMENT_CURSOR_INVALID" })
        : new Error("Agreement page unavailable"),
    }),
    useCreateCrewAgreement: mutation,
    useCreateCrewAgreementSigningSession: mutation,
    useRetryCrewAgreementSend: mutation,
    useRetryCrewAgreementArchive: mutation,
    useSyncCrewAgreement: mutation,
  };
});
import { CrewAgreementsDialog } from "./crew-agreements-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  state.cursorError = false;
  act(() => root.unmount());
  vi.clearAllMocks();
  state.failed = true;
  state.loaded = false;
  state.nextPageError = true;
  state.fetching = false;
});
function render() {
  root = createRoot(host);
  act(() =>
    root.render(
      <CrewAgreementsDialog
        crewId="crew-1"
        members={[]}
        isOwner={false}
        focusAgreementId="later-agreement"
        open
        onOpenChange={() => {}}
      />
    )
  );
}
it("stops searching later pages after an error and leaves an explicit retry", () => {
  render();
  expect(state.next).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Agreement page unavailable");
  const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "retry");
  expect(retry).toBeDefined();
  act(() => retry!.click());
  expect(state.next).toHaveBeenCalledOnce();
  expect(state.refetch).not.toHaveBeenCalled();
});
it("does not interrupt an existing refresh to search for an agreement", () => {
  state.failed = false;
  state.fetching = true;
  render();
  expect(state.next).not.toHaveBeenCalled();
});
it("continues searching when the query is idle and healthy", () => {
  state.failed = false;
  render();
  expect(state.next).toHaveBeenCalledOnce();
});

it("retains loaded agreements after refresh failure and retries the refresh", () => {
  state.loaded = true;
  state.nextPageError = false;
  render();
  expect(host.textContent).toContain("Loaded agreement");
  expect(host.textContent).toContain("Agreement page unavailable");
  const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!;
  act(() => retry.click());
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(state.next).not.toHaveBeenCalled();
});
it("retains loaded agreements after pagination failure and retries only that page", () => {
  state.loaded = true;
  render();
  expect(host.textContent).toContain("Loaded agreement");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "loadMore")).toBe(
    false
  );
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click());
  expect(state.next).toHaveBeenCalledOnce();
  expect(state.refetch).not.toHaveBeenCalled();
});
it("disables explicit pagination while refreshing loaded agreements", () => {
  state.loaded = true;
  state.failed = false;
  state.fetching = true;
  render();
  const more = [...host.querySelectorAll("button")].find((b) => b.textContent === "loadMore")!;
  expect(more.disabled).toBe(true);
  act(() => more.click());
  expect(state.next).not.toHaveBeenCalled();
});

it("restarts after the server rejects a continuation cursor", async () => {
  state.cursorError = true;
  state.failed = true;
  state.nextPageError = true;
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!.click()
  );
  expect(state.refetch).toHaveBeenCalledTimes(1);
  expect(state.next).not.toHaveBeenCalled();
});
