import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewCoordinator } from "./media-preview-coordinator";

afterEach(() => {
  vi.useRealTimers();
});

describe("MediaPreviewCoordinator", () => {
  it("arms a hover before granting the single preview owner", () => {
    vi.useFakeTimers();
    const coordinator = new MediaPreviewCoordinator(260);

    expect(coordinator.requestHover("clip-a")).toBe(true);
    expect(coordinator.ownership("clip-a")).toBe("pending");
    expect(coordinator.playingOwner()).toBeNull();

    vi.advanceTimersByTime(259);
    expect(coordinator.ownership("clip-a")).toBe("pending");

    vi.advanceTimersByTime(1);
    expect(coordinator.ownership("clip-a")).toBe("hover");
    expect(coordinator.playingOwner()).toEqual({ id: "clip-a", intent: "hover" });
  });

  it("cancels pending and active hover ownership without a late restart", () => {
    vi.useFakeTimers();
    const coordinator = new MediaPreviewCoordinator(200);

    coordinator.requestHover("clip-a");
    coordinator.cancelHover("clip-a");
    vi.runAllTimers();
    expect(coordinator.ownership("clip-a")).toBe("idle");

    coordinator.requestHover("clip-a");
    vi.runAllTimers();
    coordinator.cancelHover("clip-a");
    expect(coordinator.playingOwner()).toBeNull();
  });

  it("keeps the canvas interruption callback bound when passed by reference", () => {
    vi.useFakeTimers();
    const coordinator = new MediaPreviewCoordinator(100);
    const interruptHover = coordinator.interruptHover;

    coordinator.requestHover("clip-a");
    interruptHover();
    vi.runAllTimers();

    expect(coordinator.ownership("clip-a")).toBe("idle");
    expect(coordinator.playingOwner()).toBeNull();
  });

  it("rechecks canvas eligibility at the delayed activation boundary", () => {
    vi.useFakeTimers();
    const coordinator = new MediaPreviewCoordinator(100);
    let canvasIdle = true;

    coordinator.requestHover("clip-a", () => canvasIdle);
    canvasIdle = false;
    vi.runAllTimers();

    expect(coordinator.ownership("clip-a")).toBe("idle");
    expect(coordinator.playingOwner()).toBeNull();
  });

  it("gives explicit playback priority and never resurrects a denied hover", () => {
    vi.useFakeTimers();
    const coordinator = new MediaPreviewCoordinator(100);

    coordinator.requestHover("clip-a");
    vi.runAllTimers();
    const clipBLease = coordinator.claimManual("clip-b");

    expect(coordinator.ownership("clip-a")).toBe("idle");
    expect(coordinator.ownership("clip-b")).toBe("manual");
    expect(coordinator.requestHover("clip-c")).toBe(false);

    coordinator.releaseManual(clipBLease);
    vi.runAllTimers();
    expect(coordinator.ownership("clip-c")).toBe("idle");
    expect(coordinator.playingOwner()).toBeNull();

    expect(coordinator.requestHover("clip-c")).toBe(true);
    vi.runAllTimers();
    expect(coordinator.playingOwner()).toEqual({ id: "clip-c", intent: "hover" });
  });

  it("moves manual ownership atomically between players", () => {
    const coordinator = new MediaPreviewCoordinator(0);

    const clipALease = coordinator.claimManual("clip-a");
    coordinator.claimManual("clip-b");

    expect(coordinator.ownership("clip-a")).toBe("idle");
    expect(coordinator.ownership("clip-b")).toBe("manual");
    expect(coordinator.playingOwner()).toEqual({ id: "clip-b", intent: "manual" });

    coordinator.releaseManual(clipALease);
    expect(coordinator.playingOwner()).toEqual({ id: "clip-b", intent: "manual" });
  });

  it("stops every intent when the page loses playback ownership", () => {
    vi.useFakeTimers();
    const coordinator = new MediaPreviewCoordinator(100);

    coordinator.requestHover("clip-a");
    coordinator.stopAll();
    vi.runAllTimers();
    expect(coordinator.playingOwner()).toBeNull();

    coordinator.claimManual("clip-b");
    coordinator.stopAll();
    expect(coordinator.ownership("clip-b")).toBe("idle");
  });

  it("rejects a late release from an older manual playback lease", () => {
    const coordinator = new MediaPreviewCoordinator(0);
    const firstLease = coordinator.claimManual("clip-a");

    coordinator.claimManual("clip-b");
    const currentLease = coordinator.claimManual("clip-a");
    coordinator.releaseManual(firstLease);

    expect(currentLease.serial).not.toBe(firstLease.serial);
    expect(coordinator.ownership("clip-a")).toBe("manual");
    expect(coordinator.playingOwner()).toEqual({ id: "clip-a", intent: "manual" });
  });
});
