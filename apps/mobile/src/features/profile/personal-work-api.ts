import { api } from "@/lib/api-client";
/** Resolve permission-checked playback; never construct URLs from private bucket keys. */
export async function getPersonalWorkLink(id: string, signal?: AbortSignal): Promise<string> {
  if (!id.trim()) throw new Error("Missing work ID");
  const raw = await api.postForm<unknown>(
    "/vedio/play/personal/getLink",
    { id },
    { service: "content", signal }
  );
  if (typeof raw !== "string" || !raw.trim()) throw new Error("No playable video");
  const url = new URL(raw.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Invalid playback link");
  return url.href;
}
