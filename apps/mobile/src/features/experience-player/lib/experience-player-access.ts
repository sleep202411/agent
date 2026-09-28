import type { ExperienceAccessRequirement } from "@repo/shared/experience-runtime";

export interface ExperiencePlayerAccess {
  canAccess: (requirement: ExperienceAccessRequirement) => boolean;
  /** Refresh durable entitlements before showing a purchase prompt. Never debits. */
  checkAccess?: (requirement: ExperienceAccessRequirement) => Promise<boolean>;
  requestAccess: (requirement: ExperienceAccessRequirement) => Promise<boolean>;
  formatPrice: (amount: number) => string;
}
