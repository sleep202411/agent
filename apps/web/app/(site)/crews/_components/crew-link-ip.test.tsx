import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CrewLinkIp } from "./crew-link-ip";
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/components/ui/native-select", () => ({
  NativeSelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <button data-selection={value} onClick={() => onChange("ip")}>
      Choose fixture IP
    </button>
  ),
  NativeSelectOption: () => null,
}));
vi.mock("@/src/lib/api", () => ({ api: h }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
let root: Root, host: HTMLDivElement, qc: QueryClient;
const pause = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};
function button(text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === text
  )!;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.get
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.endsWith("/crew")
        ? { crewId: null, version: 4, choices: [{ id: "crew", name: "Crew" }] }
        : { items: [{ id: "ip", title: "Film IP" }], nextCursor: null }
    );
  h.put.mockReset().mockResolvedValue({});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  host.remove();
});
async function selectIp() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <CrewLinkIp crewId="crew" userId="owner" />
      </QueryClientProvider>
    )
  );
  await act(async () => button("linkIp").click());
  await pause();
  await act(async () => button("Choose fixture IP").click());
  await pause();
}
it("requires selection and confirmation, sends the current version and refreshes Crew links", async () => {
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  await selectIp();
  expect(h.put).not.toHaveBeenCalled();
  await act(async () => button("confirmLink").click());
  await pause();
  expect(h.put).toHaveBeenCalledWith("/aurora/ip-commerce/me/ips/ip/crew", {
    data: { crewId: "crew", expectedVersion: 4 },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["crew-linked-ips", "crew"] });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("does not offer a write when the target Crew is absent from authorized choices", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/crew")
      ? { crewId: null, version: 4, choices: [] }
      : { items: [{ id: "ip", title: "Film IP" }], nextCursor: null }
  );
  await selectIp();
  expect(button("confirmLink").disabled).toBe(true);
  expect(h.put).not.toHaveBeenCalled();
});
it("warns about reassociation and retains the selection after a rejected save", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/crew")
      ? { crewId: "other", version: 4, choices: [{ id: "crew", name: "Crew" }] }
      : { items: [{ id: "ip", title: "Film IP" }], nextCursor: null }
  );
  h.put.mockRejectedValue(new Error("Link version changed"));
  await selectIp();
  expect(document.body.textContent).toContain("linkedElsewhere");
  await act(async () => button("confirmLink").click());
  await pause();
  expect(document.body.textContent).toContain("Link version changed");
  expect(button("Choose fixture IP").dataset.selection).toBe("ip");
});
