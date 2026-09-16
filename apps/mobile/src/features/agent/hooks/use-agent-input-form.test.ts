import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useAgentInputForm } from "./use-agent-input-form";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const questions = ["a", "b", "c"].map((id) => ({
  id,
  question: id,
  options: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
}));
let root: Root | undefined;
let form: ReturnType<typeof useAgentInputForm>;
const done = vi.fn();
function Probe({ busy, items }: { busy: boolean; items: typeof questions }) {
  const current = useAgentInputForm(items, busy, done);
  useLayoutEffect(() => {
    form = current;
  });
  return null;
}
async function render(key = "first", busy = false, items = questions) {
  root ??= createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Probe, { key, busy, items })));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  done.mockReset();
});
it("cannot skip questions or underflow with rapid Next/Back events", async () => {
  await render();
  await act(async () => form.choose("yes"));
  await act(async () => {
    form.submit();
    form.submit();
  });
  expect(form.step).toBe(1);
  expect(form.selected).toBeUndefined();
  expect(done).not.toHaveBeenCalled();
  await act(async () => {
    form.back();
    form.back();
  });
  expect(form.step).toBe(0);
  await act(async () => form.back());
  expect(form.step).toBe(0);
});
it("rejects old-step option/navigation callbacks while preserving valid earlier answers", async () => {
  await render();
  await act(async () => form.choose("yes"));
  const old = form;
  await act(async () => form.submit());
  await act(async () => {
    old.choose("no");
    old.back();
    old.submit();
  });
  expect(form.step).toBe(1);
  await act(async () => form.back());
  expect(form.selected).toBe("yes");
});
it("submits only valid complete answers and rejects invalid choices", async () => {
  await render();
  await act(async () => {
    form.choose("unknown");
    form.submit();
  });
  expect(form.step).toBe(0);
  for (let index = 0; index < questions.length; index++) {
    await act(async () => form.choose("yes"));
    await act(async () => form.submit());
  }
  expect(done).toHaveBeenCalledWith({ a: "yes", b: "yes", c: "yes" });
});
it("rejects retained callbacks after request replacement and while busy", async () => {
  await render();
  await act(async () => form.choose("yes"));
  const old = form;
  await render("replacement");
  await act(async () => {
    old.choose("no");
    old.submit();
  });
  expect(form.selected).toBeUndefined();
  expect(form.step).toBe(0);
  const current = form;
  await render("replacement", true);
  await act(async () => {
    current.choose("yes");
    current.submit();
  });
  expect(form.selected).toBeUndefined();
  expect(done).not.toHaveBeenCalled();
});
it("keeps empty question lists inert", async () => {
  await render("empty", false, []);
  await act(async () => {
    form.choose("yes");
    form.submit();
    form.back();
  });
  expect(form.question).toBeUndefined();
  expect(done).not.toHaveBeenCalled();
});
