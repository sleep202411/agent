import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
const s = vi.hoisted(() => ({
  user: "a",
  project: "p",
  locale: "en-US",
  dict: vi.fn(),
  submit: vi.fn(),
  dismiss: vi.fn(),
}));
const translate = (key: string) => key;
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => translate, useLocale: () => s.locale }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: s.user } }) }));
vi.mock("@/src/store", () => ({
  useAppSelector: (select: (state: object) => unknown) =>
    select({ project: { currentProjectId: s.project } }),
}));
vi.mock("@/src/lib/project-dictionaries", () => ({ fetchProjectDictionaries: s.dict }));
import { ToolParamsCard } from "./tool-params-card";
type Fields = ComponentProps<typeof ToolParamsCard>["fields"];
const fields: Fields = [
  {
    key: "stylePainting",
    label: "Style",
    type: "select",
    value: "fake",
    options: [{ label: "Invented", value: "fake" }],
  },
];
let root: Root;
let node: HTMLDivElement;
async function render(next: Fields = fields, disabled = false) {
  await act(async () =>
    root.render(
      <ToolParamsCard
        title="Parameters"
        fields={next}
        disabled={disabled}
        onSubmit={s.submit}
        onDismiss={s.dismiss}
      />
    )
  );
}
const button = (text: string) =>
  [...node.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  s.user = "a";
  s.project = "p";
  s.locale = "en-US";
  s.dict.mockReset().mockResolvedValue({
    styleOptions: [{ id: "real", info: "Real style" }],
    sizeOptions: [],
    typeOptions: [],
  });
  s.submit.mockReset();
  s.dismiss.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});
it.each(["account", "project", "locale"])(
  "cancels abandoned style reads after %s changes",
  async (change) => {
    let resolve!: (value: object) => void;
    s.dict.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    await render();
    const signal = s.dict.mock.calls[0][0] as AbortSignal;
    if (change === "account") s.user = "b";
    else if (change === "project") s.project = "q";
    else s.locale = "zh-CN";
    await render();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ styleOptions: [{ id: "old", info: "Old style" }] }));
    expect(node.textContent).not.toContain("Old style");
    expect(node.textContent).toContain("Real style");
  }
);
it("handles empty definitions and resets the current field when definitions change", async () => {
  await render([]);
  expect(node.textContent).toContain("0 / 0");
  expect(s.submit).not.toHaveBeenCalled();
  await render([{ key: "count", label: "Count", type: "number", value: 3 }]);
  expect(node.querySelector<HTMLInputElement>("input")?.value).toBe("3");
  await render([{ key: "count", label: "Count", type: "number", value: 8 }]);
  expect(node.querySelector<HTMLInputElement>("input")?.value).toBe("8");
});
it("ignores keyboard events outside the selected card and confirms its focused option once", async () => {
  await render();
  const outside = document.createElement("input");
  document.body.append(outside);
  outside.focus();
  await act(async () =>
    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  );
  expect(s.submit).not.toHaveBeenCalled();
  const option = button("Real style");
  option.focus();
  await act(async () => {
    option.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    option.click();
  });
  expect(s.submit).toHaveBeenCalledTimes(1);
  outside.remove();
});
it("keeps a failed confirmation retryable and prevents successful repeat confirmation", async () => {
  s.submit.mockImplementationOnce(() => {
    throw new Error("Try again");
  });
  const errors: string[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.message);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  await render();
  await act(async () => button("Real style").click());
  window.removeEventListener("error", onError);
  expect(errors).toContain("Try again");
  await act(async () => button("Real style").click());
  await act(async () => button("Real style").click());
  expect(s.submit).toHaveBeenCalledTimes(2);
});
it("routes Escape only from this card and dismisses once", async () => {
  await render();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  );
  expect(s.dismiss).not.toHaveBeenCalled();
  const option = button("Real style");
  await act(async () => {
    option.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    option.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
  });
  expect(s.dismiss).toHaveBeenCalledTimes(1);
  expect(s.submit).not.toHaveBeenCalled();
});
