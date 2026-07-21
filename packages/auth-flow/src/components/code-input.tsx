"use client";

/**
 * Six-cell verification code input.
 *
 * One string of state, six rendered cells: the alternative (six pieces of
 * state) is what makes paste, autofill and backspace behave differently
 * on every implementation. Everything the OTP genre expects is here —
 * paste a whole code into any cell, type straight through, backspace into
 * the previous cell, arrow-key between cells, iOS/Android SMS autofill
 * via `autocomplete="one-time-code"`. Auto-submit on the sixth digit is
 * the machine's job (`actions.setCode`).
 */

import { useEffect, useRef } from "react";

import { cx } from "./primitives";

export function CodeInput({
  value,
  length,
  disabled,
  invalid,
  label,
  cellLabel,
  describedBy,
  onChange,
  onSubmit,
}: {
  value: string;
  length: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Group's accessible name. */
  label: string;
  /** Per-cell accessible name, 1-based. */
  cellLabel: (index: number) => string;
  describedBy?: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const cells = useRef<Array<HTMLInputElement | null>>([]);

  const focusCell = (index: number) => {
    cells.current[Math.max(0, Math.min(index, length - 1))]?.focus();
  };

  /**
   * Rescue the caret, and ONLY that.
   *
   * Typing moves focus from the handlers below, because typing is what
   * causes it. This effect exists for the two cases nothing else covers:
   * the first render (focus is outside the group, so take the first empty
   * cell) and an external clear — a resend wipes `code` while the user is
   * standing on cell 4, and a caret parked past the end of the value
   * would write the next digit into position 0 while looking at cell 4.
   *
   * The guard is what makes editing possible: this used to run on every
   * `value` change and force focus onto the last filled cell, so fixing a
   * middle digit yanked the caret to the end on the first keystroke.
   */
  useEffect(() => {
    if (disabled) return;
    const focused = cells.current.findIndex(
      (cell) => cell !== null && cell === document.activeElement
    );
    if (focused >= 0 && focused <= value.length) return;
    focusCell(value.length);
    // `focusCell` is re-created each render but closes over `length` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, length, disabled]);

  const setDigit = (index: number, digit: string) => {
    const next = value.padEnd(length, " ").split("");
    next[index] = digit;
    onChange(next.join("").replace(/\s/g, "").slice(0, length));
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className="flex items-center justify-between gap-2"
    >
      {Array.from({ length }, (_, index) => {
        const digit = value[index] ?? "";
        return (
          <input
            key={index}
            ref={(node) => {
              cells.current[index] = node;
            }}
            value={digit}
            disabled={disabled}
            aria-label={cellLabel(index + 1)}
            aria-invalid={invalid || undefined}
            inputMode="numeric"
            // Only the first cell claims the OTP so mobile autofill inserts
            // the whole code once instead of the same digit six times.
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              if (!digits) return;
              if (digits.length > 1) {
                // Autofill / paste landing in a single cell.
                const next = (value.slice(0, index) + digits).slice(0, length);
                onChange(next);
                focusCell(next.length);
                return;
              }
              setDigit(index, digits);
              // Advance from the cell that was typed in, not from the end
              // of the code — that is the whole point of the fix above.
              focusCell(index + 1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace") {
                event.preventDefault();
                if (digit) {
                  // Clear from here on, NOT just this cell. The value is
                  // one compacted string (the machine strips anything
                  // that is not a digit), so a hole is not representable:
                  // blanking a middle cell slid the whole tail one place
                  // left, which put a different digit under the caret
                  // than the one that was deleted — and the next
                  // keystroke then overwrote that neighbour instead of
                  // replacing what the user was looking at, quietly
                  // eating a digit. Truncating is the one outcome the
                  // user can see: the cells still to retype are the
                  // empty ones.
                  onChange(value.slice(0, index));
                  focusCell(index);
                  return;
                }
                // Empty cell: eat the previous digit, which is what users
                // expect when correcting a mistyped code.
                onChange(value.slice(0, Math.max(0, index - 1)));
                focusCell(index - 1);
                return;
              }
              if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                focusCell(index - 1);
              }
              if (event.key === "ArrowRight" && index < length - 1) {
                event.preventDefault();
                focusCell(index + 1);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
              if (!pasted) return;
              const next = pasted.slice(0, length);
              onChange(next);
              focusCell(next.length);
            }}
            onFocus={(event) => event.currentTarget.select()}
            className={cx(
              "h-14 w-full min-w-0 rounded-xl border-0 bg-input/30 text-center text-xl font-semibold",
              "text-foreground outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
              invalid && "ring-2 ring-destructive/60",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          />
        );
      })}
    </div>
  );
}
