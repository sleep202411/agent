// @vitest-environment jsdom

/**
 * Where the caret goes after a keystroke.
 *
 * The focus effect used to list `value` as a dependency and force focus
 * onto `Math.min(value.length, length - 1)` on EVERY change — so fixing
 * the third digit of a complete code moved the caret to the sixth cell
 * the instant you typed, and the next digit went to the wrong place.
 * Focus now follows the cell that was typed in, and the effect only
 * intervenes when the caret is nowhere useful.
 */

import { createElement, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { CodeInput } from "./code-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LENGTH = 6;

let root: Root | null = null;
let container: HTMLElement | null = null;

/** Controlled host, exactly like the dialog's `state.code`. */
function mount(initial = "") {
  let latest = initial;
  let setValue: ((next: string) => void) | null = null;

  function Host() {
    const [value, set] = useState(initial);
    latest = value;
    setValue = set;
    return createElement(CodeInput, {
      value,
      length: LENGTH,
      label: "code",
      cellLabel: (index: number) => `digit ${index}`,
      onChange: set,
      onSubmit: () => {},
    });
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Host)));

  return {
    cells: () => Array.from(container!.querySelectorAll("input")),
    get value() {
      return latest;
    },
    setValue: (next: string) => act(() => setValue!(next)),
  };
}

/** A keystroke into a cell: the browser replaces the selected digit. */
function typeInto(input: HTMLInputElement, digit: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, digit);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function focusedIndex(cells: HTMLInputElement[]): number {
  return cells.findIndex((cell) => cell === document.activeElement);
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("CodeInput caret", () => {
  it("starts in the first cell", () => {
    const ui = mount();
    expect(focusedIndex(ui.cells())).toBe(0);
  });

  it("advances one cell per digit while typing straight through", () => {
    const ui = mount();
    typeInto(ui.cells()[0]!, "1");
    expect(ui.value).toBe("1");
    expect(focusedIndex(ui.cells())).toBe(1);

    typeInto(ui.cells()[1]!, "2");
    expect(ui.value).toBe("12");
    expect(focusedIndex(ui.cells())).toBe(2);
  });

  it("stays put when a MIDDLE digit of a complete code is corrected", () => {
    const ui = mount("123456");
    const cells = ui.cells();
    act(() => cells[2]!.focus());

    typeInto(cells[2]!, "9");

    expect(ui.value).toBe("129456");
    // The bug: this used to jump to cell 5, so the next keystroke landed
    // at the end of the code instead of on the digit after the one fixed.
    expect(focusedIndex(ui.cells())).toBe(3);
  });

  it("does not steal focus back to the end while the user edits", () => {
    const ui = mount("123456");
    const cells = ui.cells();
    act(() => cells[0]!.focus());
    expect(focusedIndex(ui.cells())).toBe(0);

    // A re-render with the same value must not move anything.
    ui.setValue("123456");
    expect(focusedIndex(ui.cells())).toBe(0);
  });

  it("pulls the caret back when a resend clears the code underneath it", () => {
    const ui = mount("123456");
    const cells = ui.cells();
    act(() => cells[4]!.focus());

    // What `code_sent` does on a resend.
    ui.setValue("");

    // Otherwise the next digit would be written into position 0 while the
    // user is looking at cell 4.
    expect(focusedIndex(ui.cells())).toBe(0);
  });

  it("lands after the last digit of a code pasted into one cell", () => {
    const ui = mount();
    typeInto(ui.cells()[0]!, "1234");
    expect(ui.value).toBe("1234");
    expect(focusedIndex(ui.cells())).toBe(4);
  });

  it("clears from the caret on when a filled middle cell is backspaced", () => {
    const ui = mount("123456");
    const cells = ui.cells();
    act(() => cells[2]!.focus());

    act(() => {
      cells[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });

    // The bug: this used to blank cell 3 inside a string the machine then
    // re-compacts, so "123456" became "12456" — every later digit slid
    // one cell left, a DIFFERENT digit than the deleted one sat under the
    // caret, and retyping there overwrote its neighbour. A hole is not
    // representable in a six-digit string, so the delete truncates, and
    // the cells still to fill are visibly the empty ones.
    expect(ui.value).toBe("12");
    expect(focusedIndex(ui.cells())).toBe(2);

    // Retyping from there rebuilds the code exactly, with nothing eaten.
    typeInto(ui.cells()[2]!, "9");
    expect(ui.value).toBe("129");
    expect(focusedIndex(ui.cells())).toBe(3);
  });

  it("clears the whole code when the first cell is backspaced", () => {
    const ui = mount("123456");
    const cells = ui.cells();
    act(() => cells[0]!.focus());
    act(() => {
      cells[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    expect(ui.value).toBe("");
    expect(focusedIndex(ui.cells())).toBe(0);
  });

  it("walks backwards on backspace through an empty cell", () => {
    const ui = mount("12");
    const cells = ui.cells();
    act(() => cells[2]!.focus());
    act(() => {
      cells[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    expect(ui.value).toBe("1");
    expect(focusedIndex(ui.cells())).toBe(1);
  });
});
