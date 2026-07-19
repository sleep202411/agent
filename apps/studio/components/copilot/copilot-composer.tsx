"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export function CopilotComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  sendDisabled = false,
  canSendWithoutText = false,
  placeholder,
  inputLabel,
  sendLabel,
  stopLabel,
  inlineTokens,
  attachmentBar,
  leadingAction,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  sendDisabled?: boolean;
  /** Allow sending with empty text (e.g. an attachment carries the content). */
  canSendWithoutText?: boolean;
  placeholder: string;
  inputLabel: string;
  sendLabel: string;
  stopLabel: string;
  inlineTokens?: ReactNode;
  /** Rendered above the input row (attachment chips, errors). */
  attachmentBar?: ReactNode;
  /** Rendered before the input (e.g. an attach button). */
  leadingAction?: ReactNode;
  autoFocus?: boolean;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? "auto" : "hidden";
  }, [inlineTokens, value]);

  const canSend = (Boolean(value.trim()) || canSendWithoutText) && !sendDisabled && !busy;
  const enhanced = Boolean(inlineTokens);

  const textarea = (className?: string) => (
    <textarea
      ref={textareaRef}
      id={inputId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (canSend) onSubmit();
        }
      }}
      rows={1}
      autoFocus={autoFocus}
      placeholder={placeholder}
      className={cn(
        "min-h-10 resize-none bg-transparent py-2 text-sm leading-5 text-white/88 outline-none placeholder:text-white/28",
        className
      )}
    />
  );

  const action = busy ? (
    <button
      type="button"
      onClick={onStop}
      aria-label={stopLabel}
      className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.1] text-white transition hover:bg-white/[0.15] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
    >
      <IconPlayerStopFilled className="size-4" />
    </button>
  ) : (
    <button
      type="submit"
      disabled={!canSend}
      aria-label={sendLabel}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-2xl transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        canSend ? "bg-white text-black hover:bg-white/90" : "bg-white/[0.06] text-white/24"
      )}
    >
      <IconArrowUp className="size-4.5" stroke={2} />
    </button>
  );

  return (
    <form
      className={cn("rounded-[20px] bg-white/[0.06] p-2.5", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSubmit();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <label className="sr-only" htmlFor={inputId}>
        {inputLabel}
      </label>
      {attachmentBar ? <div className="px-2 pb-1.5">{attachmentBar}</div> : null}
      {enhanced ? (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 px-2">
            {inlineTokens}
            {textarea("min-w-48 flex-[1_1_18rem] px-0")}
          </div>
          <div
            className={cn(
              "mt-0.5 flex min-h-10 items-center",
              leadingAction ? "justify-between" : "justify-end"
            )}
          >
            {leadingAction}
            {action}
          </div>
        </>
      ) : (
        <div className="flex items-end gap-2">
          {leadingAction}
          {textarea("flex-1 px-2")}
          {action}
        </div>
      )}
    </form>
  );
}
