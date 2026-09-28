// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "./admin-session-boundary";
import { AccountSettingsPanel } from "./account-settings-panel";
import type { AdminSession } from "@/lib/admin-session";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const handlers = vi.hoisted(() => ({ reset: undefined as undefined | (() => Promise<void>) }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
    handlers.reset = onConfirm;
    return null;
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const session: AdminSession = {
  site: {
    key: "global",
    label: "Global",
    shortLabel: "Global",
    domain: "fixture.invalid",
    databaseLabel: "Fixture",
    badge: "test",
  },
  user: {
    id: "alice",
    email: "alice@fixture.invalid",
    displayName: "Alice",
    status: "active",
    siteScope: "global",
    roleKeys: [],
    requireMfa: false,
    mfaEnabledAt: null,
    permissions: [],
  },
  session: { id: "one" },
};

const response = (ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: () =>
    Promise.resolve({ code: ok ? 200 : 503, msg: "Account service unavailable", data: {} }),
});
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function render(scope = "one") {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(
      <AdminSessionBoundary scopeKey={scope}>
        <AccountSettingsPanel session={session} />
      </AdminSessionBoundary>
    )
  );
}
function submit(index = 0) {
  container
    .querySelectorAll("form")
    [index]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
async function input(id: string, value: string) {
  await act(async () => {
    const element = container.querySelector<HTMLInputElement>(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("excludes overlapping profile/password/MFA changes and retains failed drafts", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response());
  await render();
  await input('input[maxlength="120"]', "Edited name");
  await act(async () => {
    submit();
    submit(1);
    await handlers.reset!();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(response(false)));
  expect(container.textContent).toContain("Account service unavailable");
  expect(container.querySelector<HTMLInputElement>('input[maxlength="120"]')!.value).toBe(
    "Edited name"
  );
  await act(async () => submit());
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
it("preserves same-session drafts but abandons account-changing responses", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  await render();
  await input('input[maxlength="120"]', "Draft");
  await render();
  expect(container.querySelector<HTMLInputElement>('input[maxlength="120"]')!.value).toBe("Draft");
  await act(async () => submit());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await render("two");
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response()));
  expect(router.refresh).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>('input[maxlength="120"]')!.value).toBe("Alice");
});
it("propagates failed MFA reset to the retryable confirmation", async () => {
  fetchMock.mockResolvedValueOnce(response(false)).mockResolvedValue(response());
  await render();
  await act(async () => {
    await expect(handlers.reset!()).rejects.toThrow("Account service unavailable");
  });
  expect(router.refresh).not.toHaveBeenCalled();
  await act(async () => handlers.reset!());
  expect(router.refresh).toHaveBeenCalledTimes(1);
});

it("keeps password drafts after failure and clears them only on accepted change", async () => {
  fetchMock.mockResolvedValueOnce(response(false)).mockResolvedValue(response());
  await render();
  const fields = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
  for (const [index, field] of [...fields].entries()) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        index === 0 ? "old-password" : "new-password"
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => submit(1));
  expect(fields[1]!.value).toBe("new-password");
  await act(async () => submit(1));
  expect([...fields].every((field) => field.value === "")).toBe(true);
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
