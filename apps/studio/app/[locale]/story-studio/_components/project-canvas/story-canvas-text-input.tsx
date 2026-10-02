"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
} from "react";

type TextElement = HTMLInputElement | HTMLTextAreaElement;

/** Keep IME composition local; canvas projections and autosave must not replace it. */
export function StoryCanvasTextInput({
  value,
  onValueChange,
  multiline = false,
  rows,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  multiline?: boolean;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  rows?: number;
  "aria-label"?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  const lastCommitted = useRef(value);
  const textRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);
  useLayoutEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);
  useLayoutEffect(() => {
    if (!focused.current && !composing.current) {
      setText(value);
      textRef.current = value;
      lastCommitted.current = value;
    }
  }, [value]);
  const commit = (next: string) => {
    if (next === lastCommitted.current) return;
    lastCommitted.current = next;
    onValueChangeRef.current(next);
  };
  useEffect(() => {
    return () => commit(textRef.current);
  }, []);
  const shared = {
    ...props,
    value: text,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: (event: React.FocusEvent<TextElement>) => {
      focused.current = false;
      composing.current = false;
      const next = event.currentTarget.value;
      textRef.current = next;
      commit(next);
    },
    onChange: (event: ChangeEvent<TextElement>) => {
      const next = event.currentTarget.value;
      textRef.current = next;
      setText(next);
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event: CompositionEvent<TextElement>) => {
      composing.current = false;
      const next = event.currentTarget.value;
      textRef.current = next;
      setText(next);
    },
    onPointerDown: (event: React.PointerEvent<TextElement>) => event.stopPropagation(),
    onClick: (event: React.MouseEvent<TextElement>) => event.stopPropagation(),
    onDoubleClick: (event: React.MouseEvent<TextElement>) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent<TextElement>) => event.stopPropagation(),
  };
  return multiline ? <textarea {...shared} rows={rows ?? 1} /> : <input {...shared} />;
}
