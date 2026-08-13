"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  /** Sits immediately left of the send/stop button (e.g. model / permission selects). */
  beforeSend,
  autoFocus = false,
  appearance = "default",
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
  /** Bottom toolbar, leading side (e.g. attach). Stacked layout only. */
  leadingAction?: ReactNode;
  /** Bottom toolbar, immediately left of send/stop (mode / model). */
  beforeSend?: ReactNode;
  autoFocus?: boolean;
  appearance?: "default" | "fizz-agent";
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tokensRef = useRef<HTMLSpanElement>(null);
  // Inline tokens sit IN the text flow: the chip is absolutely positioned on
  // the first line and the textarea's first line indents past it, so typed
  // text continues right after the chip and wraps to the full width below.
  const [tokenIndent, setTokenIndent] = useState(0);
  const inputId = useId();

  useLayoutEffect(() => {
    if (!inlineTokens) {
      setTokenIndent(0);
      return;
    }
    const tokens = tokensRef.current;
    if (!tokens) return;
    const measure = () => setTokenIndent(tokens.offsetWidth + 8);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tokens);
    return () => observer.disconnect();
  }, [inlineTokens]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? "auto" : "hidden";
  }, [inlineTokens, tokenIndent, value]);

  const canSend = (Boolean(value.trim()) || canSendWithoutText) && !sendDisabled && !busy;
  /**
   * Stacked layout (prompt on top, toolbar bottom) when there are toolbar
   * affordances — attach / mode / model / inline chips. A bare composer
   * (canvas copilot with only send) stays a compact single row.
   */
  const stacked = Boolean(inlineTokens || leadingAction || beforeSend);

  const textarea = (className?: string, style?: React.CSSProperties) => (
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
      style={style}
      className={cn(
        "w-full resize-none bg-transparent py-2 text-sm text-white/88 outline-none placeholder:text-white/28",
        appearance === "fizz-agent" ? "min-h-14 leading-relaxed" : "min-h-10 leading-5",
        className
      )}
    />
  );

  const action = busy ? (
    <button
      type="button"
      onClick={onStop}
      aria-label={stopLabel}
      className={cn(
        "grid shrink-0 place-items-center text-white transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        appearance === "fizz-agent"
          ? "size-9 rounded-full bg-primary shadow-[0_8px_24px_rgba(0,0,0,0.3)] hover:scale-[1.03] hover:bg-primary/90 active:scale-95"
          : "size-10 rounded-2xl bg-white/[0.1] hover:bg-white/[0.15]"
      )}
    >
      <IconPlayerStopFilled className="size-4" />
    </button>
  ) : (
    <button
      type="submit"
      disabled={!canSend}
      aria-label={sendLabel}
      className={cn(
        "grid shrink-0 place-items-center transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        appearance === "fizz-agent" ? "size-9 rounded-full" : "size-10 rounded-2xl",
        canSend
          ? appearance === "fizz-agent"
            ? "bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.3)] hover:scale-[1.03] hover:bg-primary/90 active:scale-95"
            : "bg-white text-black hover:bg-white/90"
          : appearance === "fizz-agent"
            ? "bg-primary text-primary-foreground opacity-30"
            : "bg-white/[0.06] text-white/24"
      )}
    >
      <IconArrowUp className="size-4.5" stroke={2} />
    </button>
  );

  const toolbar = (
    <div
      className={cn(
        "flex items-center",
        appearance === "fizz-agent" ? "min-h-9 gap-1" : "min-h-10 gap-1.5"
      )}
    >
      {leadingAction}
      <div className="min-w-0 flex-1" />
      {beforeSend}
      {action}
    </div>
  );

  return (
    <form
      data-appearance={appearance}
      className={cn(
        appearance === "fizz-agent"
          ? "liquid-rim relative rounded-[22px] bg-white/[0.055] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_16px_48px_rgba(0,0,0,0.28)] backdrop-blur-2xl"
          : "rounded-[20px] bg-white/[0.06] p-2.5",
        className
      )}
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
      {stacked ? (
        <div className="flex flex-col gap-0.5">
          <div className="relative min-w-0 px-2">
            {inlineTokens ? (
              <span
                ref={tokensRef}
                className="absolute top-[9px] left-2 z-10 inline-flex max-w-[70%]"
              >
                {inlineTokens}
              </span>
            ) : null}
            {textarea(
              inlineTokens ? "px-0" : undefined,
              tokenIndent ? { textIndent: `${tokenIndent}px` } : undefined
            )}
          </div>
          {toolbar}
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          {textarea("min-w-0 flex-1 px-2")}
          {action}
        </div>
      )}
    </form>
  );
}
