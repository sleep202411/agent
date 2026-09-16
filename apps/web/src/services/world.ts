/**
 * World service — quick-create flows used by the Studio composer entry point.
 */
import { api } from "@/src/lib/api";

/**
 * Quick-create a world + product in one shot (used when the user kicks off
 * a new creation from /studio without picking a world).
 *
 * Returns the ids the caller needs to navigate to the project workspace.
 */
export const quickCreateWorldProduct = (name: string, signal?: AbortSignal) =>
  api.post<{ worldId: string; projectId: string }>("/api/user/world/create/quick/worldproduct", {
    signal,
    data: { name },
  });
