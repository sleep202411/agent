import { z } from "zod";
import type { StorageLike } from "@/src/features/interactive-film/persistence/repository";
import {
  JinlingPlayerOriginSchema,
  JinlingPlayerTraitSchema,
  type JinlingPlayerProfile,
} from "./player-profile";

const PROFILE_DRAFT_SCHEMA_VERSION = 1 as const;
const DEFAULT_STORAGE_KEY = "fizzdragon:interactive-film:draft:v1:jinling-rumeng";

export const JinlingProfileDraftSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_DRAFT_SCHEMA_VERSION),
    displayName: z.string(),
    origin: JinlingPlayerOriginSchema.nullable(),
    trait: JinlingPlayerTraitSchema.nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((draft, context) => {
    if (Array.from(draft.displayName.trim()).length > 8) {
      context.addIssue({
        code: "custom",
        path: ["displayName"],
        message: "Player name must contain at most 8 characters",
      });
    }
  });

export type JinlingProfileDraft = z.infer<typeof JinlingProfileDraftSchema>;

export class JinlingProfileDraftError extends Error {
  constructor(
    readonly code: "STORAGE_UNAVAILABLE" | "INVALID_DATA" | "WRITE_FAILED",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "JinlingProfileDraftError";
  }
}

function browserStorage(): StorageLike {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new JinlingProfileDraftError(
      "STORAGE_UNAVAILABLE",
      "Local profile draft storage is unavailable"
    );
  }
  return window.localStorage;
}

export function createEmptyJinlingProfileDraft(now: string): JinlingProfileDraft {
  return {
    schemaVersion: PROFILE_DRAFT_SCHEMA_VERSION,
    displayName: "",
    origin: null,
    trait: null,
    updatedAt: now,
  };
}

export function completeJinlingProfileDraft(
  draft: JinlingProfileDraft
): JinlingPlayerProfile | null {
  if (!draft.displayName.trim() || !draft.origin || !draft.trait) {
    return null;
  }

  return {
    displayName: draft.displayName.trim(),
    origin: draft.origin,
    trait: draft.trait,
  };
}

export class JinlingProfileDraftRepository {
  constructor(
    private readonly injectedStorage?: StorageLike,
    private readonly storageKey = DEFAULT_STORAGE_KEY
  ) {}

  load(): JinlingProfileDraft | null {
    const serialized = this.storage.getItem(this.storageKey);
    if (serialized === null) return null;

    try {
      return JinlingProfileDraftSchema.parse(JSON.parse(serialized));
    } catch (error) {
      throw new JinlingProfileDraftError("INVALID_DATA", "The local profile draft is invalid", {
        cause: error,
      });
    }
  }

  save(draft: JinlingProfileDraft): void {
    let validated: JinlingProfileDraft;
    try {
      validated = JinlingProfileDraftSchema.parse(draft);
    } catch (error) {
      throw new JinlingProfileDraftError("INVALID_DATA", "The profile draft failed validation", {
        cause: error,
      });
    }

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(validated));
    } catch (error) {
      throw new JinlingProfileDraftError("WRITE_FAILED", "The profile draft could not be saved", {
        cause: error,
      });
    }
  }

  clear(): void {
    this.storage.removeItem(this.storageKey);
  }

  private get storage(): StorageLike {
    return this.injectedStorage ?? browserStorage();
  }
}
