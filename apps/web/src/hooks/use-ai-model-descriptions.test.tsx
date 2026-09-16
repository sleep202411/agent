import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  locale: "en-US",
  models: [
    {
      id: "seed-1.6",
      name: "Seed",
      description: "cached English",
      cost: 7,
      inputSchema: { type: "object", properties: {} },
    },
    {
      id: "custom",
      name: "Custom",
      description: "Custom description",
      cost: 9,
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));
vi.mock("@/src/i18n/i18n", () => ({ useLocale: () => s.locale }));
vi.mock("@/src/lib/api", () => ({ backendApi: {} }));
vi.mock("@/src/store", () => ({
  store: {},
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ aiModelCache: { aiModelCache: { "/one": s.models }, aiModelCacheLoading: false } }),
}));
import { useAiModels } from "./use-ai-models";
let root: Root;
let result: ReturnType<typeof useAiModels>;
function View() {
  const current = useAiModels("/one");
  useLayoutEffect(() => {
    result = current;
  });
  return null;
}
async function render() {
  await act(async () => root.render(<View />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.locale = "en-US";
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
it("refreshes existing descriptions across all three languages without changing shared cache or model parameters", async () => {
  await render();
  expect(result.models[0].description).toContain("ByteDance");
  s.locale = "zh-CN";
  await render();
  expect(result.models[0].description).toContain("字节跳动");
  s.locale = "zh-HK";
  await render();
  expect(result.models[0].description).toContain("字節跳動");
  expect(s.models[0].description).toBe("cached English");
  expect(result.models[0].cost).toBe(7);
  expect(result.models[0].inputSchema).toBe(s.models[0].inputSchema);
  expect(result.models[1].description).toBe("Custom description");
});
