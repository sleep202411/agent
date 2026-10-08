// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AdminSessionBoundary } from "../admin-session-boundary";
import { InstructorPicker } from "./instructor-picker";
import type { CourseInstructor } from "./types";

vi.mock("../billing/shared", async (original) => ({
  ...(await original<object>()),
  AdminDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <section>{children}</section> : null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const onChange = vi.fn();
const instructor = (id: string, share = ""): CourseInstructor => ({
  userId: id,
  nickName: id,
  avatar: "",
  description: "",
  sharePercent: share,
});
const user = (id: string) => ({ userId: id, nickName: id, email: null, phone: null });
function envelope(data: unknown) {
  return { ok: true, json: () => Promise.resolve({ code: 200, data }) };
}

async function render(view: ReactNode) {
  vi.stubGlobal("fetch", fetchMock);
  if (!root) {
    container = document.createElement("div");
    root = createRoot(container);
  }
  await act(async () =>
    root!.render(<AdminSessionBoundary scopeKey="alice">{view}</AdminSessionBoundary>)
  );
}

function click(text: string) {
  [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === text)!
    .click();
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("lets each instructor keep an independent share", async () => {
  await render(
    <InstructorPicker
      instructors={[instructor("teacher-1", "50"), instructor("teacher-2", "20")]}
      onChange={onChange}
    />
  );
  const inputs = [...container.querySelectorAll<HTMLInputElement>("input")].filter(
    (input) => input.getAttribute("type") === "number"
  );
  expect(inputs.map((input) => input.value)).toEqual(["50", "20"]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      inputs[1],
      "30"
    );
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith([
    instructor("teacher-1", "50"),
    instructor("teacher-2", "30"),
  ]);
});

it("captures share when adding an instructor", async () => {
  fetchMock.mockResolvedValue(envelope([user("new-user")]));
  await render(<InstructorPicker instructors={[]} onChange={onChange} />);
  await act(async () => click("添加讲师"));
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="邮箱 / 手机 / 昵称 / ID"]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "new");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => click("查找"));
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find(
        (button) => button.querySelector(".font-mono") && button.textContent?.includes("new-user")
      )!
      .click();
  });
  await act(async () => {
    const share = container.querySelector<HTMLInputElement>('input[placeholder="可选"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(share, "25");
    share.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => click("添加"));
  expect(onChange).toHaveBeenCalledWith([instructor("new-user", "25")]);
});
