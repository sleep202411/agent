import type { Enrollment } from "./learning-api";
export function instructorEarnedCredits(row: Enrollment, userId: string): string {
  if (row.status !== "approved") return "0";
  if (row.instructorShares?.length)
    return row.instructorShares.find((share) => share.teacherId === userId)?.credits ?? "0";
  return row.teacherId === userId ? row.teacherCredits : "0";
}
