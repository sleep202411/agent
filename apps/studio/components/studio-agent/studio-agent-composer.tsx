"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  IconAlertCircle,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconFileDescription,
  IconLoader2,
  IconPaperclip,
  IconPlayerStop,
  IconPhotoPlus,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { StudioAgentDeliveryMode } from "@/lib/studio-agent";

import type {
  StudioAgentCanonicalAttachment,
  StudioAgentComposerAttachment,
} from "./use-studio-agent-composer-attachments";

export interface StudioAgentComposerLabels {
  input: string;
  placeholder: string;
  stop: string;
  queued: (count: number) => string;
  deliveryModeMenu: string;
  deliveryMode: Record<
    StudioAgentDeliveryMode,
    {
      label: string;
      description?: string;
    }
  >;
  attachments: {
    add: string;
    drop: string;
    remove: (fileName: string) => string;
    retry: (fileName: string) => string;
    uploading: (progress: number) => string;
    processing: string;
    ready: string;
    failed: string;
    fileSize: (sizeBytes: number) => string;
  };
}

export interface StudioAgentComposerAttachmentControls {
  items: readonly StudioAgentComposerAttachment[];
  accept: string;
  onAddFiles: (files: FileList | readonly File[]) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export interface StudioAgentComposerProps {
  value: string;
  labels: StudioAgentComposerLabels;
  deliveryMode: StudioAgentDeliveryMode;
  onDeliveryModeChange: (mode: StudioAgentDeliveryMode) => void;
  onValueChange: (value: string) => void;
  onSubmit: (
    value: string,
    mode: StudioAgentDeliveryMode,
    attachments: readonly StudioAgentCanonicalAttachment[]
  ) => void | Promise<void>;
  onStop?: () => void;
  isRunning?: boolean;
  isSubmitting?: boolean;
  queuedCount?: number;
  disabled?: boolean;
  leading?: ReactNode;
  chips?: ReactNode;
  /** Rendered in the action row next to the attachment button (permission menu). */
  permission?: ReactNode;
  attachments?: StudioAgentComposerAttachmentControls;
  className?: string;
}

const runningModes: readonly StudioAgentDeliveryMode[] = ["steer", "enqueue", "stop_and_send"];

export function StudioAgentComposer({
  value,
  labels,
  deliveryMode,
  onDeliveryModeChange,
  onValueChange,
  onSubmit,
  onStop,
  isRunning = false,
  isSubmitting = false,
  queuedCount = 0,
  disabled = false,
  leading,
  chips,
  permission,
  attachments,
  className,
}: StudioAgentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const submissionRef = useRef<Promise<void> | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const availableModes = isRunning ? runningModes : (["send"] as const);
  const effectiveMode = availableModes.includes(deliveryMode as (typeof availableModes)[number])
    ? deliveryMode
    : availableModes[0];
  const readyAttachments =
    attachments?.items.flatMap((item) => (item.attachment ? [item.attachment] : [])) ?? [];
  const hasBlockingAttachments =
    attachments?.items.some((item) => item.status !== "ready") ?? false;
  const hasContent = value.trim().length > 0 || readyAttachments.length > 0;
  const canSubmit = !disabled && !isSubmitting && !hasBlockingAttachments && hasContent;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(200, Math.max(56, textarea.scrollHeight))}px`;
  }, [value]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit || submissionRef.current) return;
    const submission = Promise.resolve()
      .then(() => onSubmit(value.trim(), effectiveMode, readyAttachments))
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (submissionRef.current === submission) submissionRef.current = null;
      });
    submissionRef.current = submission;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  const handleDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!attachments || !hasFiles(event)) return;
    event.preventDefault();
    if (disabled) return;
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };

  const handleDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!attachments || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  };

  const handleDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (!attachments || !hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!attachments || !hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled) return;
    if (event.dataTransfer.files.length > 0) attachments.onAddFiles(event.dataTransfer.files);
  };

  return (
    <form
      data-slot="studio-agent-composer"
      data-running={isRunning || undefined}
      onSubmit={submit}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "liquid-rim relative rounded-[22px] bg-white/[0.055] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_16px_48px_rgba(0,0,0,0.28)] backdrop-blur-2xl",
        className
      )}
    >
      {isDraggingFiles ? (
        <div className="pointer-events-none absolute inset-1.5 z-20 flex items-center justify-center rounded-[18px] bg-[oklch(0.22_0_0_/_0.96)] px-6 text-center shadow-[0_18px_54px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
          <div className="flex items-center gap-2 text-xs font-medium text-white/82">
            <IconPhotoPlus aria-hidden="true" className="size-4 text-white/58" />
            <span>{labels.attachments.drop}</span>
          </div>
        </div>
      ) : null}

      {chips ? <div className="flex min-w-0 flex-wrap gap-1.5 px-1 pt-1">{chips}</div> : null}

      {attachments && attachments.items.length > 0 ? (
        <div className="grid min-w-0 gap-1.5 px-1 pt-1.5" aria-live="polite">
          {attachments.items.map((attachment) => (
            <ComposerAttachmentRow
              key={attachment.id}
              attachment={attachment}
              labels={labels.attachments}
              disabled={disabled || isSubmitting}
              onRetry={() => attachments.onRetry(attachment.id)}
              onRemove={() => attachments.onRemove(attachment.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 items-start gap-2">
        {leading ? <div className="shrink-0 pt-1">{leading}</div> : null}
        <textarea
          ref={textareaRef}
          aria-label={labels.input}
          placeholder={labels.placeholder}
          value={value}
          disabled={disabled}
          rows={1}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-h-14 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1.5 py-2 text-sm/relaxed text-white/88 outline-none placeholder:text-white/28 disabled:opacity-45"
        />
      </div>

      <div className="flex min-h-9 items-center gap-1 px-0.5">
        {attachments ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={attachments.accept}
              multiple
              hidden
              tabIndex={-1}
              onChange={(event) => {
                if (event.currentTarget.files?.length) {
                  attachments.onAddFiles(event.currentTarget.files);
                }
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              aria-label={labels.attachments.add}
              disabled={disabled || isSubmitting}
              onClick={() => fileInputRef.current?.click()}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/48 transition-colors hover:bg-white/[0.06] hover:text-white/78 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
            >
              <IconPaperclip aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : null}
        {permission ? <div className="shrink-0">{permission}</div> : null}
        <div className="min-w-0 flex-1">
          {queuedCount > 0 ? (
            <span className="truncate px-1.5 text-[10px] text-white/36">
              {labels.queued(queuedCount)}
            </span>
          ) : null}
        </div>

        {isRunning && onStop ? (
          <button
            type="button"
            aria-label={labels.stop}
            onClick={onStop}
            disabled={disabled}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/48 transition-colors hover:bg-white/[0.06] hover:text-white/78 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
          >
            <IconPlayerStop aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}

        {isRunning ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={labels.deliveryModeMenu}
              disabled={disabled || isSubmitting}
              className="inline-flex h-8 max-w-36 items-center gap-1 rounded-full px-2.5 text-[11px] text-white/52 outline-none transition-colors hover:bg-white/[0.06] hover:text-white/78 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
            >
              <span className="truncate">{labels.deliveryMode[effectiveMode].label}</span>
              <IconChevronDown aria-hidden="true" className="size-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={8}
              className="liquid-rim w-72 rounded-2xl bg-[oklch(0.18_0_0_/_0.98)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_72px_rgba(0,0,0,0.68)] backdrop-blur-[36px]"
            >
              <DropdownMenuRadioGroup
                value={effectiveMode}
                onValueChange={(nextValue) =>
                  onDeliveryModeChange(nextValue as StudioAgentDeliveryMode)
                }
              >
                {availableModes.map((mode) => (
                  <DropdownMenuRadioItem
                    key={mode}
                    value={mode}
                    className="min-h-11 items-start rounded-xl px-3 py-2 pr-9 focus:bg-white/[0.06]"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-white/86">
                        {labels.deliveryMode[mode].label}
                      </span>
                      {labels.deliveryMode[mode].description ? (
                        <span className="mt-0.5 block text-[10px]/relaxed text-white/40">
                          {labels.deliveryMode[mode].description}
                        </span>
                      ) : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <button
          type="submit"
          aria-label={labels.deliveryMode[effectiveMode].label}
          disabled={!canSubmit}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition-[transform,opacity,background-color] hover:scale-[1.03] hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 active:scale-95 disabled:scale-100 disabled:opacity-30"
        >
          {isSubmitting ? (
            <IconLoader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <IconArrowUp aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </form>
  );
}

function ComposerAttachmentRow({
  attachment,
  labels,
  disabled,
  onRetry,
  onRemove,
}: {
  attachment: StudioAgentComposerAttachment;
  labels: StudioAgentComposerLabels["attachments"];
  disabled: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const statusLabel =
    attachment.status === "uploading"
      ? labels.uploading(attachment.progress)
      : attachment.status === "processing"
        ? labels.processing
        : attachment.status === "ready"
          ? labels.ready
          : labels.failed;
  const StatusIcon =
    attachment.status === "uploading" || attachment.status === "processing"
      ? IconLoader2
      : attachment.status === "ready"
        ? IconCheck
        : IconAlertCircle;
  const AttachmentIcon = attachment.mediaType.startsWith("image/")
    ? IconPhotoPlus
    : IconFileDescription;

  return (
    <div
      data-status={attachment.status}
      className="relative min-w-0 overflow-hidden rounded-xl bg-black/18 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <AttachmentIcon aria-hidden="true" className="size-4 shrink-0 text-white/42" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-white/78">{attachment.fileName}</p>
          <p
            className={cn(
              "mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-white/36",
              attachment.status === "failed" && "text-destructive/82"
            )}
          >
            <StatusIcon
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0",
                (attachment.status === "uploading" || attachment.status === "processing") &&
                  "animate-spin motion-reduce:animate-none"
              )}
            />
            <span className="truncate">
              {attachment.error ?? statusLabel} · {labels.fileSize(attachment.sizeBytes)}
            </span>
          </p>
        </div>

        {attachment.status === "failed" && attachment.retryable ? (
          <button
            type="button"
            aria-label={labels.retry(attachment.fileName)}
            disabled={disabled}
            onClick={onRetry}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
          >
            <IconRefresh aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          aria-label={labels.remove(attachment.fileName)}
          disabled={disabled}
          onClick={onRemove}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45"
        >
          <IconX aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      {attachment.status === "uploading" ? (
        <div
          role="progressbar"
          aria-label={`${attachment.fileName}: ${statusLabel}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={attachment.progress}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-white/[0.05]"
        >
          <div
            className="h-full bg-white/55 transition-[width] duration-150 ease-out"
            style={{ width: `${attachment.progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}
