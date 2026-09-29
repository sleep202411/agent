import { api } from "@/lib/api-client";
export interface ExperienceEntry {
  id?: string;
  title: string;
  organization: string;
  location: string;
  startTime: string;
  endTime: string;
  description: string;
}
export async function getCreatorExperience(
  creatorId: string,
  signal?: AbortSignal
): Promise<ExperienceEntry[]> {
  const raw = await api.get<unknown>(`/user/resumer/list/${encodeURIComponent(creatorId)}`, {
    service: "content",
    signal,
  });
  return parseExperience(raw);
}
export function parseExperience(raw: unknown): ExperienceEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "list" in raw
      ? raw.list
      : raw == null
        ? []
        : undefined;
  if (!Array.isArray(list)) throw new Error("Invalid experience response");
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return list
    .filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === "object" && !Array.isArray(row)
    )
    .map((row) => ({
      id: typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : undefined,
      title: text(row.title),
      organization: text(row.organization),
      location: text(row.location),
      startTime: text(row.startTime),
      endTime: text(row.endTime),
      description: text(row.description),
    }))
    .filter(
      (row) =>
        row.title ||
        row.organization ||
        row.location ||
        row.startTime ||
        row.endTime ||
        row.description
    );
}

export async function getMyExperience(signal?: AbortSignal) {
  return parseExperience(
    await api.get<unknown>("/user/resumer/me", { service: "content", signal })
  );
}
export async function saveExperience(entry: ExperienceEntry) {
  if (!entry.title.trim()) throw new Error("Title is required");
  const data = {
    ...(entry.id !== undefined ? { id: entry.id } : {}),
    title: entry.title.trim(),
    organization: entry.organization.trim(),
    location: entry.location.trim(),
    startTime: entry.startTime.trim(),
    endTime: entry.endTime.trim(),
    description: entry.description.trim(),
  };
  await api.post(entry.id === undefined ? "/user/resumer/add" : "/user/resumer/update", {
    service: "content",
    data,
  });
}
export async function deleteExperience(id: string) {
  if (!id.trim()) throw new Error("Experience id is required");
  await api.post(`/user/resumer/delete/${encodeURIComponent(id)}`, { service: "content" });
}
