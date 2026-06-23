import { api } from "@/lib/api";

/**
 * The user's legacy Java projects, read by the Nest server straight from MySQL
 * (`GET /aurora/legacy-projects/my`) — no Java HTTP hop. `id` is a string (the
 * MySQL bigint cast to CHAR).
 */
export interface LegacyProject {
  id: string;
  name: string;
  cover: string | null;
  aspectRatio: string | null;
  status: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function listMyLegacyProjects(): Promise<LegacyProject[]> {
  const data = await api.get<{ items: LegacyProject[] }>("/aurora/legacy-projects/my");
  return data.items;
}
