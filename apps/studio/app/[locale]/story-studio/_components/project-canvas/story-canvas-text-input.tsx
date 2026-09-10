"use client";

import { useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from "react";

type TextElement = HTMLInputElement | HTMLTextAreaElement;

/** Keep IME composition local; canvas projections and autosave must not replace it. */
export function StoryCanvasTextInput({
  value,
  onValueChange,
  multiline = false,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  const lastCommitted = useRef(value);
  useLayoutEffect(() => {
    if (!focused.current && !composing.current) {
      setText(value);
      lastCommitted.current = value;
    }
  }, [value]);
  const commit = (next: string) => {
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onValueChange(next);
  };
  const shared = {
    ...props,
    value: text,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: (event: React.FocusEvent<TextElement>) => {
      focused.current = false;
      composing.current = false;
      commit(event.currentTarget.value);
    },
    onChange: (event: ChangeEvent<TextElement>) => {
      const next = event.currentTarget.value;
      setText(next);
      if (!composing.current) commit(next);
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event: CompositionEvent<TextElement>) => {
      composing.current = false;
      const next = event.currentTarget.value;
      setText(next);
      commit(next);
    },
    onPointerDown: (event: React.PointerEvent<TextElement>) => event.stopPropagation(),
    onClick: (event: React.MouseEvent<TextElement>) => event.stopPropagation(),
    onDoubleClick: (event: React.MouseEvent<TextElement>) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent<TextElement>) => event.stopPropagation(),
  };
  return multiline ? <textarea {...shared} rows={1} /> : <input {...shared} />;
}
