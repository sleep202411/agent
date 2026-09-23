// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { CrewProductionOverviewDTO } from "@/app/(site)/crews/_hooks/use-crew";
import { ProductionProjectProperties } from "./production-project-properties";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  useUpdateCrewProductionProject: () => ({ mutateAsync: state.save, isPending: false }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/ui/calendar", () => ({ Calendar: () => null }));
vi.mock("@/app/(site)/messages/_components/crew-logo", () => ({ CrewLogo: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
async function render(version = 7) {
  const overview = {
    capabilities: { manage: true },
    project: {
      version,
      status: "backlog",
      priority: null,
      leadMemberId: null,
      startDate: null,
      startDateGranularity: "day",
      targetDate: null,
      targetDateGranularity: "day",
    },
    labels: [],
    labelOptions: [],
  } as unknown as CrewProductionOverviewDTO;
  await act(async () =>
    root.render(
      <ProductionProjectProperties
        crewId="crew"
        crewName="Crew"
        crewLogo=""
        members={[]}
        displays={new Map()}
        overview={overview}
      />
    )
  );
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.clearAllMocks();
});
it.each(["start", "target"])(
  "retains a failed %s date draft and original version for retry",
  async (kind) => {
    state.save.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
    await render();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(`[aria-label="properties.${kind}Date"]`)!.click()
    );
    const input = document.querySelector<HTMLInputElement>('[aria-label="properties.dateInput"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "2026-10-15"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(state.save).toHaveBeenCalledWith({
      expectedVersion: 7,
      [`${kind}Date`]: "2026-10-15",
      [`${kind}DateGranularity`]: "day",
    });
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="properties.dateInput"]')?.value
    ).toBe("2026-10-15");
    await render(8);
    await act(async () =>
      input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.save).toHaveBeenLastCalledWith({
      expectedVersion: 7,
      [`${kind}Date`]: "2026-10-15",
      [`${kind}DateGranularity`]: "day",
    });
    expect(document.querySelector('[aria-label="properties.dateInput"]')).toBeNull();
  }
);

it("serializes date saves while the response is pending", async () => {
  let finish!: (value: undefined) => void;
  state.save.mockReturnValue(
    new Promise<undefined>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="properties.startDate"]')!.click()
  );
  const input = document.querySelector<HTMLInputElement>('[aria-label="properties.dateInput"]')!;
  const form = input.closest("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(input.matches(":disabled")).toBe(true);
  await act(async () => finish(undefined));
  expect(document.querySelector('[aria-label="properties.dateInput"]')).toBeNull();
});
