// Web-compatible Java Content study field format.
export interface EducationEntry {
  schoolName: string;
  major: string;
  startDate: string;
  /** Optional. Empty / missing ⇒ ongoing. */
  endDate?: string;
}

/** Parse the on-wire `study` string into structured entries. Tolerant of:
 *  - empty / null
 *  - already-structured (legacy free-text rows are returned as
 *    `schoolName`-only entries so old data still renders something)
 *  - malformed JSON (returns []) */
export function parseEducation(study: string | null | undefined): EducationEntry[] {
  if (!study || typeof study !== "string") return [];
  const trimmed = study.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map((e) => ({
          schoolName: typeof e.schoolName === "string" ? e.schoolName : "",
          major: typeof e.major === "string" ? e.major : "",
          startDate: typeof e.startDate === "string" ? e.startDate : "",
          endDate: typeof e.endDate === "string" ? e.endDate : "",
        }));
    } catch {
      return [];
    }
  }
  // Legacy free-text rows — keep them visible by mapping each non-empty
  // line into a school-name-only entry.
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ schoolName: line, major: "", startDate: "", endDate: "" }));
}

/** Serialize back to the on-wire `study` string. Drops fully-empty entries. */
export function serializeEducation(entries: EducationEntry[]): string {
  const cleaned = entries
    .map((e) => ({
      schoolName: e.schoolName.trim(),
      major: e.major.trim(),
      startDate: e.startDate.trim(),
      endDate: (e.endDate ?? "").trim(),
    }))
    .filter((e) => e.schoolName || e.major || e.startDate || e.endDate);
  return cleaned.length ? JSON.stringify(cleaned) : "";
}
