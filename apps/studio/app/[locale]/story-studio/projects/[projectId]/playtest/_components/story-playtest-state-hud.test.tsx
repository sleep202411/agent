// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it } from "vitest";
import messages from "@/messages/en-US.json";
import { StoryPlaytestStateHud } from "./story-playtest-state-hud";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const rows = [
  { key: "courage", label: "Courage", initialValue: 10 },
  { key: "has.key", label: "Found the key", initialValue: false },
];
async function render(values: Record<string, unknown> = {}, allRows = rows) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <StoryPlaytestStateHud
          values={values}
          rows={allRows}
          completedEndingIds={["private.ending"]}
        />
      </NextIntlClientProvider>
    )
  );
}
it("keeps variables out of the header until opened and shows initial values before the player reports state", async () => {
  await render();
  expect(document.querySelector("aside")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector("aside")?.textContent).toContain("Courage10");
  expect(document.querySelector("aside")?.textContent).toContain("Found the keyNo");
  expect(document.querySelector("aside")?.textContent).not.toContain("private.ending");
  expect(document.querySelector("aside")?.querySelector('input[type="search"]')).toBeNull();
});
it("shows numeric changes and boolean values without recreating the open panel", async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  const panel = document.querySelector("aside");
  await render({ courage: 12, "has.key": true });
  expect(document.querySelector("aside")).toBe(panel);
  expect(panel?.textContent).toContain("+2");
  expect(panel?.textContent).toContain("Yes");
  await render({ courage: 0, "has.key": false });
  expect(panel?.textContent).toContain("-10");
  expect(panel?.textContent).toContain("No");
});
it("offers search only for a long list", async () => {
  await render(
    {},
    Array.from({ length: 10 }, (_, i) => ({
      key: `key${i}`,
      label: `Variable ${i}`,
      initialValue: 0,
    }))
  );
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector('input[type="search"]')).not.toBeNull();
});
