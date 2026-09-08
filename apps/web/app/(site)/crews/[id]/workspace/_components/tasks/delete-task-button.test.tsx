import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import { DeleteTaskButton } from "./delete-task-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) =>
    en.crewTasks.deletion[key as keyof typeof en.crewTasks.deletion],
}));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("task deletion confirmation", () => {
  it.each([204, 409])("handles HTTP %s without optimistic deletion", async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        status === 204
          ? new Response(null, { status })
          : new Response(JSON.stringify({ message: "Refresh before deleting" }), { status })
      );
    vi.stubGlobal("fetch", fetch);
    const onDeleted = vi.fn();
    await act(async () =>
      root.render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
        >
          <DeleteTaskButton
            task={{ id: "task-1", crewId: "crew-1", version: 7 }}
            onDeleted={onDeleted}
          />
        </QueryClientProvider>
      )
    );
    await act(async () => container.querySelector("button")!.click());
    expect(fetch).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Financial records will be retained");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Delete task"
    )!;
    await act(async () => {
      confirm.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetch).toHaveBeenCalledWith(
      "/aurora/crew-tasks/task-1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 7 }),
        credentials: "include",
      })
    );
    if (status === 204) {
      expect(onDeleted).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } else {
      expect(onDeleted).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(toast.error).toHaveBeenCalledWith("Refresh before deleting");
    }
  });
});
