import { ExperienceAccessRequiredError } from "@repo/experience-engine";
import type { ExperienceJourney, ExperienceRuntimeManifest } from "@repo/shared/experience-runtime";
import type { ExperiencePlayerAccess } from "./experience-player-access";
import {
  getExperienceJourneyReplayAccess,
  restoreExperienceJourneyAnchor,
  rewindExperienceJourney,
  validateExperienceJourney,
  type ExperienceJourneyEntryCheckpoint,
} from "./experience-journey-model";

export interface ExperienceJourneyReplayInput {
  manifest: ExperienceRuntimeManifest;
  journey: ExperienceJourney;
  sceneId: string;
  watchedAssetIds: readonly string[];
  access?: ExperiencePlayerAccess;
  /** Flush the current story before a purchase can leave the player. */
  beforePurchase?: () => void | Promise<void>;
  /** Owns both the player generation and authenticated account. */
  ownsSession: () => boolean;
  signal?: AbortSignal;
  /** Synchronous replacement of engine/presentation state after all checks pass. */
  commit: (entry: ExperienceJourneyEntryCheckpoint, journey: ExperienceJourney) => void;
}

/** One replay at a time. No engine mutation or scene-entry action before authorization. */
export class ExperienceJourneyReplay {
  private pending = false;
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
  }

  async replay(input: ExperienceJourneyReplayInput): Promise<"restored" | "cancelled" | "busy"> {
    if (this.pending) return "busy";
    this.pending = true;
    const generation = this.generation;
    const current = () => {
      input.signal?.throwIfAborted();
      if (generation !== this.generation || !input.ownsSession())
        throw new DOMException("Replay session changed", "AbortError");
    };
    try {
      current();
      // Work on an immutable snapshot while the entitlement service is pending.
      const manifest = structuredClone(input.manifest);
      const journey = validateExperienceJourney(manifest, structuredClone(input.journey));
      const watchedAssetIds = [...input.watchedAssetIds];
      // Validate the entry before showing any charge prompt. This temporary check
      // only validates data; the live entitlement check below gates the commit.
      restoreExperienceJourneyAnchor(manifest, journey, input.sceneId, {
        canAccess: () => true,
        watchedAssetIds,
      });
      const requirements = getExperienceJourneyReplayAccess(manifest, journey, input.sceneId);
      for (const requirement of requirements) {
        current();
        const access = input.access;
        if (!access) throw new ExperienceAccessRequiredError(requirement);
        const allowed = access.checkAccess
          ? await access.checkAccess(requirement)
          : access.canAccess(requirement);
        current();
        if (!allowed) {
          await input.beforePurchase?.();
          current();
          const accepted = await access.requestAccess(requirement);
          current();
          if (!accepted) return "cancelled";
        }
      }
      current();
      // A successful dialog is not proof of ownership. Recheck every boundary,
      // including ancestor routes, immediately before replacing the current run.
      const entry = restoreExperienceJourneyAnchor(manifest, journey, input.sceneId, {
        canAccess: (requirement) => input.access?.canAccess(requirement) ?? false,
        watchedAssetIds,
      });
      const nextJourney = rewindExperienceJourney(journey, input.sceneId);
      current();
      input.commit(entry, nextJourney);
      return "restored";
    } finally {
      this.pending = false;
    }
  }
}
