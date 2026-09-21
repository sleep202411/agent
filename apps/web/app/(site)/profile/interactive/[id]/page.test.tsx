import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Page from "./page";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), push: vi.fn(), locale: 0 }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => {
    const messages = [en, cn, hk][mocks.locale]!.profile;
    return messages[key as keyof typeof messages];
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: React.ComponentProps<"button"> & { size?: string; variant?: string }) => {
    void _size;
    void _variant;
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("@xyflow/react", async () => {
  const { useState } = await import("react");
  return {
    useNodesState: (initial: unknown[]) => [...useState(initial), vi.fn()],
    useEdgesState: (initial: unknown[]) => [...useState(initial), vi.fn()],
    ReactFlow: ({ nodes }: { nodes: { id: string }[] }) => (
      <div data-testid="graph">{nodes.map((n) => n.id).join(",")}</div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Handle: () => null,
    Position: { Top: "top", Bottom: "bottom" },
    addEdge: vi.fn(),
  };
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it.each([0, 1, 2])(
  "reports unavailable saving in locale %s without changing the draft or claiming success",
  async (locale) => {
    mocks.locale = locale;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Page />));
      const graph = host.querySelector('[data-testid="graph"]')!.textContent;
      expect(graph).not.toBe("");
      const label = [en, cn, hk][locale]!.profile.interactiveSave;
      const save = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
      expect(save).toBeTruthy();
      await act(async () => save.click());
      expect(mocks.error).toHaveBeenCalledWith(
        [en, cn, hk][locale]!.profile.interactiveSaveUnavailable
      );
      expect(mocks.success).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="graph"]')!.textContent).toBe(graph);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
);
