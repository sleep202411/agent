export const DEFAULT_MEDIA_HOVER_PREVIEW_DELAY_MS = 260;

export type MediaPreviewOwnership = "idle" | "pending" | "hover" | "manual";

export type MediaPreviewOwner = {
  id: string;
  intent: "hover" | "manual";
};

export type MediaManualPlaybackLease = Readonly<{
  ownerId: string;
  serial: number;
}>;

type ActivationGuard = () => boolean;
type Listener = () => void;

/**
 * Arbitrates every lightweight hover preview and explicit player on a surface.
 *
 * A pending hover is deliberately discarded when manual playback takes over;
 * releasing manual ownership never resurrects it under a stationary pointer.
 */
export class MediaPreviewCoordinator {
  readonly #delayMs: number;
  readonly #listeners = new Set<Listener>();
  #pendingHoverOwnerId: string | null = null;
  #hoverOwnerId: string | null = null;
  #manualLease: MediaManualPlaybackLease | null = null;
  #manualLeaseSerial = 0;
  #activationTimer: ReturnType<typeof setTimeout> | null = null;
  #interactionEpoch = 0;

  constructor(delayMs = DEFAULT_MEDIA_HOVER_PREVIEW_DELAY_MS) {
    this.#delayMs = Math.max(0, delayMs);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  ownership(ownerId: string): MediaPreviewOwnership {
    if (this.#manualLease?.ownerId === ownerId) return "manual";
    if (this.#hoverOwnerId === ownerId) return "hover";
    if (this.#pendingHoverOwnerId === ownerId) return "pending";
    return "idle";
  }

  playingOwner(): MediaPreviewOwner | null {
    if (this.#manualLease) return { id: this.#manualLease.ownerId, intent: "manual" };
    if (this.#hoverOwnerId) return { id: this.#hoverOwnerId, intent: "hover" };
    return null;
  }

  requestHover(ownerId: string, canActivate: ActivationGuard = () => true): boolean {
    if (this.#manualLease) return false;
    if (this.#hoverOwnerId === ownerId) return true;

    this.#clearActivationTimer();
    const changed =
      this.#pendingHoverOwnerId !== ownerId ||
      (this.#hoverOwnerId !== null && this.#hoverOwnerId !== ownerId);
    this.#pendingHoverOwnerId = ownerId;
    this.#hoverOwnerId = null;
    const epoch = ++this.#interactionEpoch;
    if (changed) this.#emit();

    this.#activationTimer = setTimeout(() => {
      this.#activationTimer = null;
      if (
        epoch !== this.#interactionEpoch ||
        this.#pendingHoverOwnerId !== ownerId ||
        this.#manualLease
      ) {
        return;
      }

      let eligible = false;
      try {
        eligible = canActivate();
      } catch {
        eligible = false;
      }

      this.#pendingHoverOwnerId = null;
      this.#hoverOwnerId = eligible ? ownerId : null;
      this.#emit();
    }, this.#delayMs);
    return true;
  }

  cancelHover(ownerId: string): void {
    const ownsPending = this.#pendingHoverOwnerId === ownerId;
    const ownsPreview = this.#hoverOwnerId === ownerId;
    if (!ownsPending && !ownsPreview) return;

    if (ownsPending) {
      this.#clearActivationTimer();
      this.#pendingHoverOwnerId = null;
    }
    if (ownsPreview) this.#hoverOwnerId = null;
    this.#interactionEpoch += 1;
    this.#emit();
  }

  interruptHover = (): void => {
    if (!this.#pendingHoverOwnerId && !this.#hoverOwnerId) return;
    this.#clearActivationTimer();
    this.#pendingHoverOwnerId = null;
    this.#hoverOwnerId = null;
    this.#interactionEpoch += 1;
    this.#emit();
  };

  claimManual(ownerId: string): MediaManualPlaybackLease {
    if (this.#manualLease?.ownerId === ownerId) return this.#manualLease;

    const changed =
      this.#manualLease?.ownerId !== ownerId ||
      this.#pendingHoverOwnerId !== null ||
      this.#hoverOwnerId !== null;

    this.#clearActivationTimer();
    this.#pendingHoverOwnerId = null;
    this.#hoverOwnerId = null;
    this.#manualLease = Object.freeze({
      ownerId,
      serial: ++this.#manualLeaseSerial,
    });
    this.#interactionEpoch += 1;
    if (changed) this.#emit();
    return this.#manualLease;
  }

  releaseManual(lease: MediaManualPlaybackLease): void {
    if (this.#manualLease?.ownerId !== lease.ownerId || this.#manualLease.serial !== lease.serial) {
      return;
    }
    this.#manualLease = null;
    this.#interactionEpoch += 1;
    this.#emit();
  }

  stopAll(): void {
    if (!this.#pendingHoverOwnerId && !this.#hoverOwnerId && !this.#manualLease) return;
    this.#clearActivationTimer();
    this.#pendingHoverOwnerId = null;
    this.#hoverOwnerId = null;
    this.#manualLease = null;
    this.#interactionEpoch += 1;
    this.#emit();
  }

  dispose(): void {
    this.#clearActivationTimer();
    this.#pendingHoverOwnerId = null;
    this.#hoverOwnerId = null;
    this.#manualLease = null;
    this.#interactionEpoch += 1;
    this.#listeners.clear();
  }

  #clearActivationTimer(): void {
    if (this.#activationTimer === null) return;
    clearTimeout(this.#activationTimer);
    this.#activationTimer = null;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
