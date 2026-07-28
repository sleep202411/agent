// @vitest-environment jsdom

/**
 * The submission form is the whole point of R0's "close the loop": before
 * it, the submit button flipped a status with nothing attached and the
 * reviewer had nothing to look at.
 *
 * These pin the rules the form enforces — content is mandatory, the link
 * must be something the row can safely render as an `<a href>`, neither
 * field can outgrow its server column, and a failed attempt keeps the
 * typed content on screen next to the server's own words.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubmitDialog } from "./submit-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Real en-US copy, so a key that never landed in the message files shows
// up here as a bare `submitConfirm` and fails the queries below.
vi.mock("@/src/i18n/i18n", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, string | number>) =>
      Object.entries(vars ?? {}).reduce<string>(
        (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
        messages[ns]?.[key] ?? key
      ),
    useLocale: () => "en-US",
  };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

/** React listens on the root container, so a native input event is what a
 *  real keystroke looks like from the component's side. */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no field #${id}`);
  return el as HTMLInputElement | HTMLTextAreaElement;
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("submit dialog", () => {
  it("hands the caller both the link and the note", () => {
    const onConfirm = vi.fn();
    render(
      <SubmitDialog
        open
        onOpenChange={() => {}}
        targetLabel="Ada · Storyboard"
        onConfirm={onConfirm}
      />
    );

    type(field("submit-url"), "https://drive.example.com/ep03-cut.mp4");
    type(field("submit-note"), "Second pass, colour graded.");
    click(button("Send for Review"));

    expect(onConfirm).toHaveBeenCalledWith(
      "https://drive.example.com/ep03-cut.mp4",
      "Second pass, colour graded."
    );
  });

  it("refuses a content-free submission", () => {
    const onConfirm = vi.fn();
    render(<SubmitDialog open onOpenChange={() => {}} targetLabel="Ada" onConfirm={onConfirm} />);

    expect(button("Send for Review").disabled).toBe(true);
    click(button("Send for Review"));
    expect(onConfirm).not.toHaveBeenCalled();

    // A note on its own is enough — the link is optional, not the content.
    type(field("submit-note"), "Uploaded straight to the shared drive.");
    expect(button("Send for Review").disabled).toBe(false);
  });

  it("refuses a link the row could not safely render", () => {
    const onConfirm = vi.fn();
    render(<SubmitDialog open onOpenChange={() => {}} targetLabel="Ada" onConfirm={onConfirm} />);

    type(field("submit-url"), "javascript:alert(1)");

    expect(document.body.textContent).toContain("Enter a full http:// or https:// link");
    expect(button("Send for Review").disabled).toBe(true);
    click(button("Send for Review"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("caps both fields at the server's column widths", () => {
    // SubmitAssignmentSchema caps url at 1024 and note at 2000
    // (apps/server/src/crews/episodes/dto.ts). A pasted signed URL runs
    // long, and without the attribute the paste round-trips into a 400.
    render(<SubmitDialog open onOpenChange={() => {}} targetLabel="Ada" onConfirm={() => {}} />);

    expect(field("submit-url").maxLength).toBe(1024);
    expect(field("submit-note").maxLength).toBe(2000);
  });

  it("says so when a paste hits the cap instead of truncating silently", () => {
    const onConfirm = vi.fn();
    render(<SubmitDialog open onOpenChange={() => {}} targetLabel="Ada" onConfirm={onConfirm} />);

    // jsdom does not enforce maxLength on a programmatic value set, so
    // this stands in for the browser handing back its truncated value.
    const prefix = "https://drive.example.com/";
    const link = prefix + "a".repeat(1024 - prefix.length);
    expect(link).toHaveLength(1024);
    type(field("submit-url"), link);

    expect(document.body.textContent).toContain("Capped at 1024 characters");
    // Still a valid link — the notice is informational, not a block.
    expect(button("Send for Review").disabled).toBe(false);
  });

  it("shows the server's own words on a failed attempt", () => {
    render(
      <SubmitDialog
        open
        onOpenChange={() => {}}
        targetLabel="Ada"
        errorMessage="You are no longer a member of this crew"
        onConfirm={() => {}}
      />
    );

    expect(document.body.textContent).toContain("You are no longer a member of this crew");
    // Not swallowed into a generic "Action failed".
    expect(document.body.textContent).not.toContain("Action failed");
  });
});
