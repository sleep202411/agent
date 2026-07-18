import type { InteractiveFilmDraftContent, StoryCanvasPosition } from "@/lib/story-projects-api";

export interface StoryCanvasHistorySnapshot {
  content: InteractiveFilmDraftContent;
  nodePositions: Record<string, StoryCanvasPosition>;
}

interface CaptureOptions {
  mergeKey?: string;
  now?: number;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_MERGE_WINDOW_MS = 700;

/**
 * Session-local history for the revisioned Story draft and its separately
 * persisted layout. Restoring a snapshot creates a new server revision through
 * the existing autosave queues; server revision numbers never move backwards.
 */
export class StoryCanvasHistory {
  private readonly undoStack: StoryCanvasHistorySnapshot[] = [];
  private readonly redoStack: StoryCanvasHistorySnapshot[] = [];
  private lastMergeKey: string | null = null;
  private lastCaptureAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly limit = DEFAULT_LIMIT,
    private readonly mergeWindowMs = DEFAULT_MERGE_WINDOW_MS
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  capture(snapshot: StoryCanvasHistorySnapshot, options: CaptureOptions = {}): void {
    const now = options.now ?? Date.now();
    const mergeKey = options.mergeKey ?? null;
    const mergeWithPrevious = Boolean(
      mergeKey &&
      mergeKey === this.lastMergeKey &&
      now - this.lastCaptureAt <= this.mergeWindowMs &&
      this.undoStack.length > 0
    );

    if (!mergeWithPrevious) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.lastMergeKey = mergeKey;
    this.lastCaptureAt = now;
  }

  undo(current: StoryCanvasHistorySnapshot): StoryCanvasHistorySnapshot | null {
    const previous = this.undoStack.pop() ?? null;
    if (!previous) return null;
    this.redoStack.push(current);
    this.stopMerging();
    return previous;
  }

  redo(current: StoryCanvasHistorySnapshot): StoryCanvasHistorySnapshot | null {
    const next = this.redoStack.pop() ?? null;
    if (!next) return null;
    this.undoStack.push(current);
    this.stopMerging();
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.stopMerging();
  }

  private stopMerging(): void {
    this.lastMergeKey = null;
    this.lastCaptureAt = Number.NEGATIVE_INFINITY;
  }
}
