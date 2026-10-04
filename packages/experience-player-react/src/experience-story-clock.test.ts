// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExperienceStoryClock } from "./experience-story-clock";

/**
 * Fake timers stand in for the wall: they replace `performance.now`,
 * `setTimeout` and `requestAnimationFrame` together (frames every 16ms), which
 * is exactly the set the clock reads.
 */

// Built at import, before any fake timer exists — as the context's default
// clock is.
const clockBuiltAtImport = new ExperienceStoryClock({ paused: false });

describe("ExperienceStoryClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps story time continuous while changing speed and rearms a pending timeout", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const origin = clock.now();
    const fire = vi.fn();
    clock.setTimeout(fire, 1_000);
    vi.advanceTimersByTime(400);
    clock.setRate(2);
    expect(clock.now() - origin).toBe(400);
    expect(clock.rate).toBe(2);
    vi.advanceTimersByTime(299);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(clock.now() - origin).toBe(1_000);
    expect(fire).toHaveBeenCalledOnce();
    clock.setRate(0.5);
    vi.advanceTimersByTime(200);
    expect(clock.now() - origin).toBe(1_100);
  });

  it("changes speed while paused without advancing or firing and resumes at that speed", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const origin = clock.now();
    const fire = vi.fn();
    clock.setTimeout(fire, 1_000);
    vi.advanceTimersByTime(200);
    clock.pause();
    clock.setRate(2);
    vi.advanceTimersByTime(5_000);
    expect(clock.now() - origin).toBe(200);
    expect(clock.paused).toBe(true);
    expect(fire).not.toHaveBeenCalled();
    clock.resume();
    vi.advanceTimersByTime(399);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("keeps interval cadence and frame timestamps at the selected speed", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const origin = clock.now();
    const fire = vi.fn();
    const frame = vi.fn();
    clock.setInterval(fire, 200);
    clock.setRate(2);
    clock.requestFrame(frame);
    vi.advanceTimersByTime(16);
    expect(frame).toHaveBeenCalledWith(origin + 32);
    vi.advanceTimersByTime(84);
    expect(fire).toHaveBeenCalledOnce();
    clock.setRate(0.5);
    vi.advanceTimersByTime(399);
    expect(fire).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("freezes story time while paused and runs it on from there", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const origin = clock.now();

    vi.advanceTimersByTime(100);
    expect(clock.now() - origin).toBe(100);

    clock.pause();
    vi.advanceTimersByTime(5_000);
    expect(clock.now() - origin).toBe(100);

    clock.resume();
    vi.advanceTimersByTime(50);
    expect(clock.now() - origin).toBe(150);
  });

  it("counts nothing before the first resume of a clock built paused", () => {
    const clock = new ExperienceStoryClock({ paused: true });
    const origin = clock.now();
    const fire = vi.fn();
    clock.setTimeout(fire, 100);

    vi.advanceTimersByTime(1_000);
    expect(clock.paused).toBe(true);
    expect(clock.now()).toBe(origin);
    expect(fire).not.toHaveBeenCalled();

    // A timer set while paused starts counting at the resume.
    clock.resume();
    vi.advanceTimersByTime(99);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("fires a timeout after running time, not wall time", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const fire = vi.fn();
    clock.setTimeout(fire, 1_000);

    vi.advanceTimersByTime(600);
    clock.pause();
    vi.advanceTimersByTime(10_000);
    expect(fire).not.toHaveBeenCalled();

    clock.resume();
    vi.advanceTimersByTime(399);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(10_000);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("keeps an interval's cadence across a pause", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const fire = vi.fn();
    clock.setInterval(fire, 250);

    vi.advanceTimersByTime(250);
    expect(fire).toHaveBeenCalledTimes(1);

    // Paused 100ms into the second beat: 150ms of it are left after resume.
    vi.advanceTimersByTime(100);
    clock.pause();
    vi.advanceTimersByTime(2_000);
    expect(fire).toHaveBeenCalledTimes(1);

    clock.resume();
    vi.advanceTimersByTime(149);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(250);
    expect(fire).toHaveBeenCalledTimes(3);
  });

  it("keeps a timer cleared inside its own callback cleared", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const fire = vi.fn(() => clock.clearTimer(interval));
    const interval = clock.setInterval(fire, 100);

    vi.advanceTimersByTime(1_000);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("never fires a timer or delivers a frame cleared while paused", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const timeout = vi.fn();
    const frame = vi.fn();
    const timeoutId = clock.setTimeout(timeout, 100);
    const frameId = clock.requestFrame(frame);

    clock.pause();
    clock.clearTimer(timeoutId);
    clock.cancelFrame(frameId);
    clock.resume();
    vi.advanceTimersByTime(1_000);

    expect(timeout).not.toHaveBeenCalled();
    expect(frame).not.toHaveBeenCalled();
  });

  it("delivers a frame pending at a pause on the first frame after resume, in story time", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const delivered: number[] = [];
    clock.requestFrame((storyNow) => delivered.push(storyNow));

    clock.pause();
    vi.advanceTimersByTime(1_000);
    expect(delivered).toEqual([]);

    clock.resume();
    vi.advanceTimersToNextFrame();
    // The second spent paused is not story time.
    expect(delivered).toEqual([performance.now() - 1_000]);
    expect(delivered[0]).toBe(clock.now());
  });

  it("keeps a loop that asks for its next frame from its callback running across a pause", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    let frames = 0;
    const loop = () => {
      frames += 1;
      clock.requestFrame(loop);
    };
    clock.requestFrame(loop);

    vi.advanceTimersToNextFrame();
    expect(frames).toBe(1);

    clock.pause();
    vi.advanceTimersByTime(1_000);
    expect(frames).toBe(1);

    clock.resume();
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    expect(frames).toBe(3);
  });

  it("notifies subscribers once per transition, and a second pause or resume changes nothing", () => {
    const clock = new ExperienceStoryClock({ paused: false });
    const origin = clock.now();
    const seen: boolean[] = [];
    const unsubscribe = clock.subscribe(() => seen.push(clock.paused));

    vi.advanceTimersByTime(100);
    clock.pause();
    vi.advanceTimersByTime(50);
    clock.pause();
    vi.advanceTimersByTime(50);
    clock.resume();
    clock.resume();
    expect(seen).toEqual([true, false]);
    // Frozen from the first pause; the second neither moved nor restarted it.
    expect(clock.now() - origin).toBe(100);

    unsubscribe();
    clock.pause();
    expect(seen).toEqual([true, false]);
  });

  it("reads time and timers at each call, so fakes installed after it was built drive it", () => {
    const fire = vi.fn();
    const origin = clockBuiltAtImport.now();
    clockBuiltAtImport.setTimeout(fire, 1_000);

    vi.advanceTimersByTime(1_000);
    expect(clockBuiltAtImport.now() - origin).toBe(1_000);
    expect(fire).toHaveBeenCalledOnce();
  });
});
