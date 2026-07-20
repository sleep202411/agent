import type { FilmTrailerSummary, StoryTrailerPromptDraft } from "@/lib/story-projects-api";

interface SubmissionKeyRecord {
  fingerprint: string;
  key: string;
}

export interface StorySubmissionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class StoryProductionActionGate {
  private inFlight = false;

  tryAcquire(): boolean {
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  release(): void {
    this.inFlight = false;
  }
}

/** Retains an idempotency key until the exact request receives a confirmed response. */
export class StorySubmissionKeyRegistry {
  private readonly records = new Map<string, SubmissionKeyRecord>();

  constructor(
    private readonly namespace = "story-submission",
    private readonly storage: () => StorySubmissionStorage | null = () => null
  ) {}

  keyFor(slot: string, fingerprint: string, createKey: () => string): string {
    const current = this.records.get(slot) ?? this.read(slot);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = createKey();
    const next = { fingerprint, key };
    this.records.set(slot, next);
    this.write(slot, next);
    return key;
  }

  confirm(slot: string, fingerprint: string): void {
    const current = this.records.get(slot) ?? this.read(slot);
    if (current?.fingerprint === fingerprint) {
      this.records.delete(slot);
      this.remove(slot);
    }
  }

  private read(slot: string): SubmissionKeyRecord | null {
    try {
      const raw = this.storage()?.getItem(this.storageKey(slot));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SubmissionKeyRecord>;
      if (typeof parsed.fingerprint !== "string" || typeof parsed.key !== "string") {
        this.remove(slot);
        return null;
      }
      const record = { fingerprint: parsed.fingerprint, key: parsed.key };
      this.records.set(slot, record);
      return record;
    } catch {
      return null;
    }
  }

  private write(slot: string, record: SubmissionKeyRecord): void {
    try {
      this.storage()?.setItem(this.storageKey(slot), JSON.stringify(record));
    } catch {
      // In-memory retention still protects the active page when storage is unavailable.
    }
  }

  private remove(slot: string): void {
    try {
      this.storage()?.removeItem(this.storageKey(slot));
    } catch {
      // Storage may be unavailable in privacy mode; the in-memory record is already cleared.
    }
  }

  private storageKey(slot: string): string {
    return `${this.namespace}:${slot}`;
  }
}

export function projectLockedTrailerPrompt(trailer: FilmTrailerSummary): StoryTrailerPromptDraft {
  return {
    title: trailer.title,
    description: trailer.description,
    targetDurationMs: trailer.targetDurationMs,
    generationControl: trailer.generationControl,
    masterDirection: trailer.prompt.masterPrompt,
    referenceRoleNotes: trailer.referenceRoleNotes,
    emotionalArc: "",
    beats: trailer.prompt.timeline.map((beat, index) => ({
      id: `trailer:locked:${index + 1}`,
      startMs: beat.startMs,
      endMs: beat.endMs,
      visual: beat.visual,
      camera: beat.camera,
      action: beat.action,
      performance: beat.performance ?? "",
      emotion: beat.emotion ?? "",
      dialogue: beat.dialogue ?? "",
      audio: beat.audio ?? "",
      endState: beat.endState ?? "",
      continuity: beat.continuity ?? "",
    })),
    negativeConstraints: trailer.prompt.negativeConstraints,
    continuityNotes: trailer.continuityNotes,
  };
}
