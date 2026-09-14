// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStoryPreviewAccess } from "./use-story-preview-access";

vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return { useTranslations: () => translate };
});

let root: Root;
let container: HTMLDivElement;
let access: ReturnType<typeof useStoryPreviewAccess>["access"];
const requirement = { key: "choice:a:b", communityPointPrice: 3, title: { "en-US": "Choice" } };

function Harness() {
  const preview = useStoryPreviewAccess("en-US");
  useEffect(() => {
    access = preview.access;
  }, [preview.access]);
  return preview.dialog;
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

it("requires confirmation, allows cancellation, and keeps the access adapter stable", async () => {
  const initial = access;
  expect(access.canAccess(requirement)).toBe(false);
  let result!: Promise<boolean>;
  await act(async () => {
    result = access.requestAccess(requirement);
  });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("previewHint");
  expect(access).toBe(initial);
  await click("cancel");
  expect(await result).toBe(false);
  expect(access.canAccess(requirement)).toBe(false);
});

it("unlocks only the confirmed key for the current playtest session", async () => {
  let result!: Promise<boolean>;
  await act(async () => {
    result = access.requestAccess(requirement);
  });
  await click("unlock");
  expect(await result).toBe(true);
  expect(access.canAccess(requirement)).toBe(true);
  expect(access.canAccess({ ...requirement, key: "node:other" })).toBe(false);
  await act(async () => root.render(<Harness key="new-build" />));
  expect(access.canAccess(requirement)).toBe(false);
});

it("settles a pending confirmation when leaving the playtest", async () => {
  let result!: Promise<boolean>;
  await act(async () => {
    result = access.requestAccess(requirement);
  });
  await act(async () => root.render(null));
  expect(await result).toBe(false);
});
