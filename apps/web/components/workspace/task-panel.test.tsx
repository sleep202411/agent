import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskPanel } from "./task-panel";
import type { Task } from "@/src/store/slices/taskSlice";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
const h = vi.hoisted(() => ({
  tasks: {} as Record<string, Task>,
  error: null as string | null,
  retry: vi.fn(),
  messages: {} as Record<string, string>,
}));
vi.mock("@/src/hooks/use-task-subscription", () => ({
  useTaskFetch: () => ({ error: h.error, retry: h.retry }),
}));
vi.mock("@/src/store", () => ({
  useAppSelector: (select: (s: unknown) => unknown) => select({ task: { tasks: h.tasks } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => h.messages[key] ?? key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  h.tasks = {};
  h.error = null;
  h.retry.mockReset();
  h.messages = en.workspace;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
for (const [locale, messages] of [
  ["en", en],
  ["cn", cn],
  ["hk", hk],
] as const) {
  it(`renders generation, Agent waiting and production tasks in ${locale}`, async () => {
    h.messages = messages.workspace;
    for (const type of ["image", "agent", "production"] as const)
      h.tasks[type] = {
        id: type,
        type,
        status: type === "agent" ? "waiting" : "running",
        source: "server",
        input: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    await act(async () => root.render(<TaskPanel userId="owner" />));
    for (const key of ["taskImage", "taskAgent", "taskProduction", "taskWaiting"] as const)
      expect(host.textContent).toContain(messages.workspace[key]);
  });
}
it("keeps the official empty layout after an initial read failure", async () => {
  h.error = "internal database hostname";
  await act(async () => root.render(<TaskPanel userId="owner" />));
  expect(host.innerHTML).toBe("");
});
it("retains loaded task rows after a failed refresh without extra controls", async () => {
  h.tasks.image = {
    id: "image",
    type: "image",
    status: "running",
    source: "server",
    input: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await act(async () => root.render(<TaskPanel userId="owner" />));
  const before = host.innerHTML;
  h.error = "offline";
  await act(async () => root.render(<TaskPanel userId="owner" />));
  expect(host.innerHTML).toBe(before);
  expect(host.querySelector("button")).toBeNull();
});
