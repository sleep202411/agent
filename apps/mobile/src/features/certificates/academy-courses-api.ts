import { z } from "zod";
import { api } from "@/lib/api-client";

const courseId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const localeSchema = z.enum(["en-US", "zh-CN", "zh-HK"]);
const resultSchema = z.object({
  certificateId: z.number().int().positive().safe(),
  items: z.array(z.object({ courseId, title: z.string().min(1) })).max(10),
  nextCursor: courseId.nullable(),
});
export type AcademyCourses = z.infer<typeof resultSchema>;

export async function fetchCertificateCourses(
  certificateId: number,
  locale: string,
  signal: AbortSignal,
  after?: string
): Promise<AcademyCourses> {
  z.number().int().positive().safe().parse(certificateId);
  signal.throwIfAborted();
  const params = new URLSearchParams({ locale: localeSchema.parse(locale) });
  if (after) params.set("after", courseId.parse(after));
  const result = resultSchema.parse(
    await api.get(`/academy/certificates/${certificateId}/courses?${params}`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  signal.throwIfAborted();
  if (
    result.certificateId !== certificateId ||
    new Set(result.items.map((item) => item.courseId)).size !== result.items.length ||
    result.nextCursor === after
  )
    throw new Error("Invalid Academy course mapping response.");
  return result;
}
