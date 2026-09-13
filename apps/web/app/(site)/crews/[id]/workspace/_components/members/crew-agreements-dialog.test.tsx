import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  failed: true,
  fetching: false,
  next: vi.fn(),
  refetch: vi.fn(),
}));
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
      data: { items: [], capabilities: { create: false }, summary: {} },
      isLoading: false,
      isError: state.failed,
      isFetchNextPageError: state.failed,
      isFetching: state.fetching,
      isFetchingNextPage: false,
      hasNextPage: true,
      fetchNextPage: state.next,
      refetch: state.refetch,
      error: new Error("Agreement page unavailable"),
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
  act(() => root.unmount());
  vi.clearAllMocks();
  state.failed = true;
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
  expect(state.refetch).toHaveBeenCalledOnce();
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
