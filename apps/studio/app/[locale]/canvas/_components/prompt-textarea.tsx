"use client";

import { useEffect, useRef, useState } from "react";

/**
 * IME-safe prompt textarea. The card's prompt lives in the Yjs doc, so a plain
 * controlled `value={data.prompt}` re-sets the field on every keystroke via the
 * async CRDT round-trip — which interrupts CJK (Chinese/Japanese/Korean) IME
 * composition, making those languages impossible to type. This binds the
 * textarea to LOCAL state instead: it commits to the doc on input when idle and
 * on composition end, never resets mid-composition, and reflects external
 * edits (collab / reset) only while unfocused so it can't clobber live typing.
 */
export function PromptTextarea({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const focused = useRef(false);

  // Reflect external changes (a peer's edit, a reset) only when the field is
  // idle — never while the user is typing or mid-composition.
  useEffect(() => {
    if (!composing.current && !focused.current) setDraft(value);
  }, [value]);

  return (
    <textarea
      {...rest}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!composing.current) onCommit(e.target.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
        onCommit(e.currentTarget.value);
      }}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setDraft(value);
        rest.onBlur?.(e);
      }}
    />
  );
}
