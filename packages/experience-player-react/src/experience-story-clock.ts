import { createContext } from "react";

interface StoryTimer {
  readonly fire: () => void;
  /** Null for a one-shot timeout. */
  readonly intervalMs: number | null;
  /** The story time it fires at. A pause leaves it unchanged. */
  dueAt: number;
  /** The browser timer while the clock runs; null while it is paused. */
  handle: number | null;
}

interface StoryFrame {
  readonly fire: (storyNow: number) => void;
  /** The browser frame while the clock runs; null while it is paused. */
  handle: number | null;
}

/**
 * Story time, for everything that moves the story without media: the fixed
 * scene clock, a still's screen time, a held last frame, the placeholder for
 * footage not attached yet, the charge idle timeout, and press-hold animation.
 * Media keeps its own time — a paused element stops it — so this clock is what
 * freezes the rest. Nothing that advances the story is scheduled on `window`.
 *
 * `pause()` freezes all of it at once. A timer keeps the story time it is due
 * at, so `resume()` sets it again for exactly the time it had left. A frame is
 * never delivered while paused: one requested before or during a pause arrives
 * on the first frame after the resume, so a loop that only asks for its next
 * frame from inside the callback survives the pause. Story time is
 * `performance.now()` minus the time spent paused.
 *
 * `performance.now`, `setTimeout` and `requestAnimationFrame` are read at every
 * call, never captured, so fakes installed after import drive the clock too.
 * There is no dispose: each owner clears its own timers in its effect cleanup.
 */
export class ExperienceStoryClock {
  private pausedAt: number | null;
  private pausedFor = 0;
  private nextId = 1;
  private readonly timers = new Map<number, StoryTimer>();
  private readonly frames = new Map<number, StoryFrame>();
  private readonly listeners = new Set<() => void>();

  constructor(options: { paused: boolean }) {
    this.pausedAt = options.paused ? performance.now() : null;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Story time in milliseconds. Frozen while paused. */
  now(): number {
    return (this.pausedAt ?? performance.now()) - this.pausedFor;
  }

  /** Freezes story time, its timers and its frames. A second call does nothing. */
  pause(): void {
    if (this.pausedAt !== null) return;
    this.pausedAt = performance.now();
    this.timers.forEach((timer) => {
      if (timer.handle !== null) window.clearTimeout(timer.handle);
      timer.handle = null;
    });
    this.frames.forEach((frame) => {
      if (frame.handle !== null) window.cancelAnimationFrame(frame.handle);
      frame.handle = null;
    });
    this.notify();
  }

  /** Runs story time on from where it froze. A second call does nothing. */
  resume(): void {
    if (this.pausedAt === null) return;
    this.pausedFor += performance.now() - this.pausedAt;
    this.pausedAt = null;
    this.timers.forEach((timer, id) => this.armTimer(id, timer));
    this.frames.forEach((frame, id) => this.armFrame(id, frame));
    this.notify();
  }

  /** Fires once, after `ms` of story time. */
  setTimeout(fire: () => void, ms: number): number {
    return this.addTimer(fire, ms, null);
  }

  /** Fires after every `ms` of story time. */
  setInterval(fire: () => void, ms: number): number {
    return this.addTimer(fire, ms, ms);
  }

  clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    this.timers.delete(id);
    if (timer.handle !== null) window.clearTimeout(timer.handle);
  }

  /** Calls `fire` with the story time, on the next frame the clock runs for. */
  requestFrame(fire: (storyNow: number) => void): number {
    const id = this.nextId++;
    const frame: StoryFrame = { fire, handle: null };
    this.frames.set(id, frame);
    this.armFrame(id, frame);
    return id;
  }

  cancelFrame(id: number): void {
    const frame = this.frames.get(id);
    if (!frame) return;
    this.frames.delete(id);
    if (frame.handle !== null) window.cancelAnimationFrame(frame.handle);
  }

  /**
   * Calls `listener` after every pause and every resume, and returns the
   * unsubscribe. A field, so it can be passed on unbound.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private addTimer(fire: () => void, ms: number, intervalMs: number | null): number {
    const id = this.nextId++;
    const timer: StoryTimer = { fire, intervalMs, dueAt: this.now() + ms, handle: null };
    this.timers.set(id, timer);
    this.armTimer(id, timer);
    return id;
  }

  // Rounded up: a browser drops the fraction of a delay, and a story timer
  // must never fire before it is due.
  private armTimer(id: number, timer: StoryTimer): void {
    if (this.pausedAt !== null) return;
    timer.handle = window.setTimeout(
      () => this.fireTimer(id),
      Math.max(0, Math.ceil(timer.dueAt - this.now()))
    );
  }

  // Looked up rather than closed over, and the pause checked, so a timer that
  // was cleared or frozen after the browser queued it does not fire.
  private fireTimer(id: number): void {
    const timer = this.timers.get(id);
    if (!timer || this.pausedAt !== null) return;
    timer.handle = null;
    if (timer.intervalMs === null) {
      this.timers.delete(id);
    } else {
      // Armed again before it fires, so a callback that clears it wins.
      timer.dueAt = this.now() + timer.intervalMs;
      this.armTimer(id, timer);
    }
    timer.fire();
  }

  private armFrame(id: number, frame: StoryFrame): void {
    if (this.pausedAt !== null) return;
    frame.handle = window.requestAnimationFrame(() => this.deliverFrame(id));
  }

  private deliverFrame(id: number): void {
    const frame = this.frames.get(id);
    if (!frame || this.pausedAt !== null) return;
    this.frames.delete(id);
    frame.fire(this.now());
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/**
 * The story clock of the player above. A component rendered without a player —
 * a spatial control on its own — gets a clock that never pauses, which is wall
 * time.
 */
export const ExperienceStoryClockContext = createContext(
  new ExperienceStoryClock({ paused: false })
);
