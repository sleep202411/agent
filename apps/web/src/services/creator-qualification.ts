export type CreatorQualificationKind = "fd" | "producer" | "skill" | "partner";

/** Assigned Java qualifications, not application submissions or account privileges. */
export function creatorQualificationKind(
  level: { id?: unknown; type?: unknown } | null | undefined
): CreatorQualificationKind | null {
  if (!level || !Number.isSafeInteger(level.id) || Number(level.id) <= 0) return null;
  if (level.id === 13) return "producer";
  if (level.type === 1) return "fd";
  if (level.type === 4) return "skill";
  if (level.type === 5) return "partner";
  return null;
}
export function isCreatorQualification(
  level: { id?: unknown; type?: unknown } | null | undefined
): boolean {
  return creatorQualificationKind(level) !== null;
}
