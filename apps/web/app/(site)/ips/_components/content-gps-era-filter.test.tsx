// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ContentGpsEraFilter } from "./content-gps-era-filter";
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
it("keeps the explicit BCE-to-CE interval, stable scale and accessible keyboard range controls", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  const render = async (start: number, end: number) =>
    act(async () =>
      root.render(<ContentGpsEraFilter startYear={start} endYear={end} onChange={change} />)
    );
  await render(-50, 50);
  let sliders = host.querySelectorAll<HTMLInputElement>('input[type="range"]');
  expect(sliders[0].value).toBe("-50");
  expect(sliders[1].value).toBe("50");
  expect(sliders[0].min).toBe("-150");
  expect(sliders[0].max).toBe("150");
  await render(-40, 60);
  sliders = host.querySelectorAll('input[type="range"]');
  expect(sliders[0].min).toBe("-150");
  expect(sliders[0].max).toBe("150");
  await render(-500, 60);
  sliders = host.querySelectorAll('input[type="range"]');
  expect(sliders[0].min).toBe("-500");
  expect(sliders[0].getAttribute("aria-valuetext")).toBe("-500");
  expect(sliders[1].step).toBe("1");
  await act(async () => root.unmount());
  host.remove();
});
