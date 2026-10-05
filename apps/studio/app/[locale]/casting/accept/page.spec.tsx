// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import Page from "./page";
import { ApiRequestError } from "@/lib/api";
const s = vi.hoisted(() => ({
  user: "a",
  token: "t",
  accept: vi.fn(),
  preview: vi.fn(),
  error: vi.fn(),
  failed: false,
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ token: s.token }),
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: s.error } }));
vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: s.user }, loading: false, signIn: vi.fn() }),
}));
vi.mock("@/app/_components/workspace-context", () => ({
  useWorkspace: () => ({ workspaces: [{ id: "w", isDefault: true }], loading: false }),
}));
vi.mock("@/app/[locale]/(studio)/characters/_lib/use-characters", () => ({
  useCharacters: () => ({
    data: [{ id: "face", name: "Actor", kind: "real_person", status: "active" }],
    isPending: false,
    isError: s.failed,
    error: new Error("read failed"),
    refetch: s.refetch,
  }),
}));
vi.mock("@/app/[locale]/(studio)/characters/_components/project-grant-consent", () => ({
  ProjectGrantConsent: ({
    onRead,
    onAttestedChange,
  }: {
    onRead: () => void;
    onAttestedChange: (v: boolean) => void;
  }) => (
    <button
      onClick={() => {
        onRead();
        onAttestedChange(true);
      }}
    >
      consent
    </button>
  ),
}));
vi.mock("@/lib/characters-api", () => ({
  acceptCastingInvite: s.accept,
  previewCastingInvite: s.preview,
  characterApiErrorCode: () => null,
  characterMediaContentUrl: () => "",
  REAL_PERSON_GRANT_CONSENT_VERSION: "v1",
}));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  s.user = "a";
  s.token = "t";
  s.failed = false;
  vi.clearAllMocks();
  s.preview.mockResolvedValue({
    status: "pending",
    acceptable: true,
    projectName: "Film",
    projectId: "p",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
async function click(text: string) {
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((b) => b.textContent === text)!
      .click();
  });
}
it("guards duplicate consent submissions and abandons late acceptance after account changes", async () => {
  let resolve!: () => void;
  s.accept.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      })
  );
  await render();
  await click("Actor");
  await click("next");
  await click("consent");
  await act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "castingAccept"
    )!;
    button.click();
    button.click();
  });
  expect(s.accept).toHaveBeenCalledTimes(1);
  const signal = s.accept.mock.calls[0][3] as AbortSignal;
  s.user = "b";
  await render();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve());
  expect(host.textContent).not.toContain("castingDoneTitle");
  expect(host.textContent).toContain("castingPickTitle");
});
it("cancels preview reads on token change", async () => {
  const signals: AbortSignal[] = [];
  s.preview.mockImplementation((_t, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  });
  await render();
  s.token = "new";
  await render();
  expect(signals[0].aborted).toBe(true);
});

it("preserves temporary preview errors and recovers through Retry", async () => {
  s.preview.mockRejectedValueOnce(
    new ApiRequestError("unavailable", "Casting service unavailable", 503)
  );
  await render();
  expect(host.textContent).toContain("Casting service unavailable");
  expect(host.textContent).not.toContain("castingInvalidBody");
  await click("retry");
  await vi.waitFor(() => expect(host.textContent).toContain("castingPickTitle"));
  expect(s.preview).toHaveBeenCalledTimes(2);
  expect(s.accept).not.toHaveBeenCalled();
});

it.each([404, 410])("does not offer retry for a missing invitation (%s)", async (status) => {
  s.preview.mockRejectedValue(
    new ApiRequestError("missing", "Invitation no longer exists", status)
  );
  await render();
  expect(host.textContent).toContain("Invitation no longer exists");
  expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "retry")).toBe(
    false
  );
});
