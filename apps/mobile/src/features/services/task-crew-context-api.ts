import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export function appendTaskContext(description: string, context: string) {
  const result = description ? `${description}\n\n${context}` : context;
  if (result.length > 10000)
    throw Error("The description would exceed 10,000 characters. Shorten it before importing.");
  return result;
}
export async function fetchTaskCrewIntroduction(
  crewId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .parse(crewId);
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration()) throw Error("Task session expired.");
  };
  current();
  const crew = z
    .object({ id: z.string(), description: z.string().nullable().optional() })
    .parse(await api.get(`/crews/${crewId}`, { service: "aurora", retry: false, signal }));
  current();
  if (crew.id !== crewId) throw Error("Crew context changed. Reload the task.");
  return crew.description ?? "";
}
