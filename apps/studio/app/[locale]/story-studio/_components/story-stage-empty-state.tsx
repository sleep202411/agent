"use client";

import { IconAlertTriangle, IconLoader2, IconMessageCircle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/** Flat canvas-level loading feedback; never introduces a placeholder card surface. */
export function StoryStageLoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 items-center justify-center gap-2 px-4 text-xs text-white/58"
    >
      <IconLoader2 aria-hidden="true" className="size-4 animate-spin" stroke={1.8} />
      <span>{label}</span>
    </div>
  );
}

/** Flat, canvas-level stage guidance. The CTA only prefills FizzAgent. */
export function StoryStageEmptyState({
  title,
  description,
  actionLabel,
  prompt,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  prompt?: string;
}) {
  const openAgentComposer = useStoryProjectUiStore((state) => state.openAgentComposer);

  return (
    <div className="flex min-h-64 items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <p className="text-sm font-medium text-white/78">{title}</p>
        <p className="mt-1.5 text-xs leading-5 text-white/58">{description}</p>
        {actionLabel && prompt ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-5"
            onClick={() => openAgentComposer(prompt)}
          >
            <IconMessageCircle aria-hidden="true" className="size-4" />
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * In-flow operational guidance for a stage that still has useful content.
 * Unlike StoryStageEmptyState it never replaces that content; the optional
 * Agent action remains a prefill-only bridge.
 */
export function StoryStageNotice({
  title,
  description,
  actionLabel,
  prompt,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  prompt?: string;
}) {
  const openAgentComposer = useStoryProjectUiStore((state) => state.openAgentComposer);

  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-3 border-y border-white/[0.08] bg-transparent px-4 py-4 text-left sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <IconAlertTriangle
          aria-hidden="true"
          className="text-brand-yellow mt-0.5 size-4 shrink-0"
          stroke={1.8}
        />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white/90">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-white/64">{description}</p>
        </div>
      </div>
      {actionLabel && prompt ? (
        <Button
          type="button"
          variant="secondary"
          className="shrink-0 self-start sm:self-center"
          onClick={() => openAgentComposer(prompt)}
        >
          <IconMessageCircle aria-hidden="true" className="size-4" />
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
