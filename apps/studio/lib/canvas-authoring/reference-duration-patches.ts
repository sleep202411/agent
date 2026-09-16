/** A probe result belongs to the exact reference snapshot that started it. */
type Reference = {
  id: string;
  url: string;
  assetId?: string;
  edgeId?: string;
  sourceNodeId?: string;
  durationSeconds?: number | null;
};
export type ReferenceDurationPatch = Reference & { field: string; measuredSeconds: number };
export function hasKnownDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
export function applyReferenceDurationPatches<T extends Reference>(
  references: Record<string, T[]> | undefined,
  patches: readonly ReferenceDurationPatch[]
): Record<string, T[]> | undefined {
  if (!references) return references;
  const next = { ...references };
  for (const patch of patches) {
    if (
      !hasKnownDuration(patch.measuredSeconds) ||
      !Object.hasOwn(next, patch.field) ||
      !next[patch.field]
    )
      continue;
    next[patch.field] = next[patch.field]!.map((row) =>
      row.id === patch.id &&
      row.url === patch.url &&
      row.assetId === patch.assetId &&
      row.edgeId === patch.edgeId &&
      row.sourceNodeId === patch.sourceNodeId &&
      Object.is(row.durationSeconds, patch.durationSeconds)
        ? { ...row, durationSeconds: patch.measuredSeconds }
        : row
    );
  }
  return next;
}
