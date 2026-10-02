// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResultLightbox, type LightboxItem } from "./result-lightbox";
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
const navigate = vi.fn();
const copy = vi.fn();
const items = ["First", "Second"].map((prompt, index) => ({
  key: String(index),
  job: { prompt, input: {}, modelId: "model", createdAtMs: Date.now() },
  output: { type: "video", url: "/video.mp4" },
})) as LightboxItem[];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  vi.resetAllMocks();
});
async function render(index = 0) {
  await act(async () =>
    root.render(
      <ResultLightbox
        items={items}
        index={index}
        modelName={() => "Model"}
        onNavigate={navigate}
        onClose={() => {}}
      />
    )
  );
}
async function clickCopy() {
  const button = Array.from(document.querySelectorAll("button")).find(
    (el) => el.textContent === "copy"
  )!;
  await act(async () => button.click());
}
it("explains clipboard failure and allows retry without losing prompt text", async () => {
  copy.mockRejectedValueOnce(new Error("Permission denied")).mockResolvedValue(undefined);
  await render();
  await clickCopy();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("copyPromptFailed");
  expect(document.body.textContent).toContain("First");
  await clickCopy();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain("copied");
  expect(copy).toHaveBeenLastCalledWith("First");
});
it("does not label a different result as copied after a delayed clipboard response", async () => {
  let finish!: () => void;
  copy.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await clickCopy();
  await render(1);
  await act(async () => finish());
  expect(document.body.textContent).toContain("Second");
  expect(document.body.textContent).not.toContain("copied");
});
it("preserves video arrow keys while supporting result navigation outside the player", async () => {
  await render();
  await act(async () =>
    document
      .querySelector("video")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
  );
  expect(navigate).not.toHaveBeenCalled();
  await act(async () =>
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
  );
  expect(navigate).toHaveBeenCalledWith(1);
});
