"use client";

import type { InteractiveStoryDraftContent, StoryProjectSummary } from "@/lib/story-projects-api";
import {
  StoryFoundationLibrary,
  type StoryFoundationCoverMediaProps,
} from "./story-foundation-library";

type FoundationField = "logline" | "synopsis";

interface StoryProjectWorldPanelProps {
  project: Pick<
    StoryProjectSummary,
    "frameProfile" | "durationPreset" | "visualStyle" | "defaultLocale"
  >;
  content: InteractiveStoryDraftContent;
  canEdit: boolean;
  coverMedia: StoryFoundationCoverMediaProps;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onClose: () => void;
}

/**
 * World (story bible) panel docked as a flush column at the canvas's left edge —
 * the same side-panel slot the catalog fills, so the rail's Catalog and World
 * buttons read as one dock. It stays canvas-rendered (not in the layout's
 * StoryProjectSidePanel) so every bible edit funnels through the canvas's
 * single-writer autosave; the catalog dock's slot is empty whenever this is
 * open, so it lands in the same visual position.
 */
export function StoryProjectWorldPanel(props: StoryProjectWorldPanelProps) {
  return (
    <aside className="flex w-[368px] shrink-0 flex-col overflow-y-auto border-r border-white/8 bg-[#0C0C0D] px-5 py-5 max-md:hidden">
      <StoryFoundationLibrary {...props} />
    </aside>
  );
}
