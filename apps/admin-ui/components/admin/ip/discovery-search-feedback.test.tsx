// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { IpCombobox } from "./discovery-panel";
const state = vi.hoisted(() => ({
  items: [],
  error: null as string | null,
  loading: false,
  retry: vi.fn(),
}));
vi.mock("./use-discovery-ip-search", () => ({ useDiscoveryIpSearch: () => state }));
// UI primitives are replaced; this exercises the real selector's status wiring.
it("shows failed searches and offers retry instead of an empty result", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.error = "Search unavailable";
  state.loading = false;
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(<IpCombobox open ipId="" ipTitle="" ipRoomNumber="" onChange={() => {}} />)
    );
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Search unavailable");
    expect(el.textContent).not.toContain("未找到 IP");
    await act(async () => el.querySelector("button")!.click());
    expect(state.retry).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
it("distinguishes loading from a successful empty search", async () => {
  state.error = null;
  state.loading = true;
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () =>
      root.render(<IpCombobox open ipId="" ipTitle="" ipRoomNumber="" onChange={() => {}} />)
    );
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Searching");
    expect(el.textContent).not.toContain("未找到 IP");
    state.loading = false;
    await act(async () =>
      root.render(<IpCombobox open ipId="" ipTitle="" ipRoomNumber="" onChange={() => {}} />)
    );
    expect(el.textContent).toContain("未找到 IP");
  } finally {
    await act(async () => root.unmount());
  }
});

vi.mock("@/components/ui/combobox", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => (
    <div>{typeof children === "function" ? null : children}</div>
  );
  return {
    Combobox: Wrapper,
    ComboboxContent: Wrapper,
    ComboboxEmpty: Wrapper,
    ComboboxInput: Wrapper,
    ComboboxItem: Wrapper,
    ComboboxList: Wrapper,
  };
});
