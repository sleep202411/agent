import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpProductionStage } from "./ip-production-stage";
const h = vi.hoisted(() => ({ generation: 1, active: true, locale: "en-US", get: vi.fn() }));
vi.mock("@/auth", () => ({ useAuth: () => ({ generation: h.generation }) }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/i18n", () => ({
  useLocale: () => h.locale,
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
}));
let root: Root, host: HTMLDivElement;
const render = (id = "ip") => act(async () => root.render(<IpProductionStage ipId={id} />));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.generation = 1;
  h.active = true;
  h.locale = "en-US";
  h.get.mockReset();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
it.each(["testing", "story_testing", "production", "released"])(
  "shows the authoritative %s stage for public viewers",
  async (stage) => {
    h.get.mockResolvedValue({ stage });
    await render("ip/encoded");
    expect(h.get).toHaveBeenCalledWith(
      "/ip-commerce/ips/ip%2Fencoded/production-stage",
      expect.objectContaining({ service: "aurora", retry: false })
    );
    expect(host.textContent).toBe(`ipProductionStage.title: ipProductionStage.${stage}`);
    expect(host.querySelector("button")).toBeNull();
  }
);
it.each(["transport", "unknown stage"])(
  "keeps %s failures visible and retries the read",
  async (mode) => {
    if (mode === "transport")
      h.get.mockRejectedValueOnce(new Error("IP access temporarily unavailable"));
    else h.get.mockResolvedValueOnce({ stage: "draft" });
    h.get.mockResolvedValueOnce({ stage: "released" });
    await render();
    expect(host.textContent).toContain(
      mode === "transport" ? "IP access temporarily unavailable" : "ipProductionStage.error"
    );
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("ipProductionStage.released");
    expect(h.get).toHaveBeenCalledTimes(2);
  }
);
it.each(["IP", "account", "locale", "background"])(
  "drops the previous stage and ignores late reads after %s changes",
  async (change) => {
    let finish!: (value: { stage: string }) => void;
    h.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await render();
    expect(host.textContent).toBe("ipProductionStage.loading");
    const signal = h.get.mock.calls[0][1].signal;
    if (change === "account") h.generation++;
    if (change === "locale") h.locale = "zh-CN";
    if (change === "background") h.active = false;
    h.get.mockResolvedValue({ stage: "production" });
    await render(change === "IP" ? "other" : "ip");
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ stage: "testing" }));
    expect(host.textContent).not.toContain("ipProductionStage.testing");
    if (change === "background") {
      expect(host.textContent).toBe("");
      h.active = true;
      await render();
    }
    expect(host.textContent).toContain("ipProductionStage.production");
  }
);
it("rejects an old account response before React renders the new session", async () => {
  let finish!: (value: { stage: string }) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  h.generation++;
  await act(async () => finish({ stage: "released" }));
  expect(host.textContent).not.toContain("ipProductionStage.released");
});
