// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthTranslate } from "../keys";
import type { AuthTransport } from "../transport";
import { AuthDialog } from "./auth-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const t: AuthTranslate = (key) => key;
const transport: AuthTransport = {
  request: vi.fn(async () => ({ status: 500, body: {} })),
};

async function mountDialog(initialInviteCode?: string) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <AuthDialog
        initialInviteCode={initialInviteCode}
        open
        onOpenChange={() => {}}
        t={t}
        transport={transport}
        onSuccess={() => {}}
      />
    );
  });

  const input = document.querySelector<HTMLInputElement>("#auth-identifier");
  if (!input) throw new Error("Identifier input did not render");
  return input;
}

function enter(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("AuthDialog identifier input", () => {
  it("stays unrestricted after a numeric prefix", async () => {
    const input = await mountDialog();

    expect(input.type).toBe("text");
    expect(input.getAttribute("inputmode")).toBeNull();

    enter(input, "505421473");
    enter(input, "505421473@qq.com");

    expect(input.value).toBe("505421473@qq.com");
  });
});

it("keeps invitation entry collapsed below login without taking focus", async () => {
  const identifier = await mountDialog();
  const optional = document.querySelector<HTMLInputElement>("#auth-optional-invite")!;
  expect(optional).not.toBeNull();
  expect(optional.closest("details")?.open).toBe(false);
  expect(document.activeElement).toBe(identifier);
  expect(
    identifier.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(optional.required).toBe(false);
});

it("shows a referral-link prefill without moving focus from sign-in", async () => {
  const identifier = await mountDialog("REF123");
  const optional = document.querySelector<HTMLInputElement>("#auth-optional-invite")!;
  expect(optional.value).toBe("REF123");
  expect(optional.closest("details")?.open).toBe(true);
  expect(document.activeElement).toBe(identifier);
});
