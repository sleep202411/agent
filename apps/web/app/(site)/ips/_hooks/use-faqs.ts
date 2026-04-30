/**
 * FAQ CRUD.
 *
 *   - `useFAQs`        — GET  /project/faq/list?projectId=
 *   - `useCreateFAQ`   — POST /project/faq/add
 *   - `useUpdateFAQ`   — POST /project/faq/update
 *   - `useDeleteFAQ`   — POST /project/faq/delete
 *
 * All four endpoints declare their fields as `(query)` in Swagger, i.e.
 * Spring `@RequestParam`. Reads go on the URL; mutations send
 * `application/x-www-form-urlencoded` via the shared `postForm` helper.
 *
 * The backend identifier is **`faqId`** (int64) — not `id`. Update and
 * delete both require `faqId` AND `projectId`. Update additionally
 * requires the full `question` + `answer` (no partial patches), so
 * call sites pass the merged values, not just the changed field.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys, postForm } from "./shared";
import type { FAQ } from "./types";

interface WireFAQ {
  faqId?: number | null;
  id?: number | null;
  projectId: number | null;
  question: string | null;
  answer: string | null;
  sort: number | null;
}

function mapWireFAQ(w: WireFAQ): FAQ {
  return {
    faqId: (w.faqId ?? w.id ?? 0) as number,
    projectId: w.projectId ?? 0,
    question: w.question ?? "",
    answer: w.answer ?? "",
    sort: w.sort ?? 0,
  };
}

async function fetchFAQs(projectId: string): Promise<FAQ[]> {
  const qs = new URLSearchParams({ projectId: String(projectId) });
  const res = await fetch(`/project/faq/list?${qs.toString()}`, {
    credentials: "include",
    headers: {
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
  });
  if (!res.ok) throw new Error(`Fetch FAQs failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    code: number;
    msg?: string;
    data: WireFAQ[] | { list?: WireFAQ[] } | null;
  };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Fetch FAQs failed");
  }
  const rows = Array.isArray(json.data) ? json.data : (json.data?.list ?? []);
  return rows.map(mapWireFAQ);
}

export function useFAQs(projectId: string) {
  return useQuery<FAQ[]>({
    queryKey: ipKeys.faqs(projectId),
    queryFn: () => fetchFAQs(projectId),
    enabled: !!projectId,
  });
}

interface CreateFAQInput {
  projectId: number;
  question: string;
  answer: string;
  sort?: number;
}

async function createFAQ(input: CreateFAQInput): Promise<{ faqId: number }> {
  const data: Record<string, string> = {
    projectId: String(input.projectId),
    question: input.question,
    answer: input.answer,
  };
  if (input.sort != null) data.sort = String(input.sort);
  const result = await postForm<{ faqId?: number; id?: number } | number | null>(
    "/project/faq/add",
    data
  );
  if (typeof result === "number") return { faqId: result };
  return { faqId: (result?.faqId ?? result?.id ?? 0) as number };
}

export function useCreateFAQ() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createFAQ,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.faqs(String(variables.projectId)) });
    },
  });
}

interface UpdateFAQInput {
  faqId: number;
  projectId: number;
  question: string;
  answer: string;
  sort?: number;
}

async function updateFAQ(input: UpdateFAQInput): Promise<void> {
  const data: Record<string, string> = {
    faqId: String(input.faqId),
    projectId: String(input.projectId),
    question: input.question,
    answer: input.answer,
  };
  if (input.sort != null) data.sort = String(input.sort);
  await postForm<unknown>("/project/faq/update", data);
}

export function useUpdateFAQ() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateFAQ,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.faqs(String(variables.projectId)) });
    },
  });
}

interface DeleteFAQInput {
  faqId: number;
  projectId: number;
}

async function deleteFAQ(input: DeleteFAQInput): Promise<void> {
  await postForm<unknown>("/project/faq/delete", {
    faqId: String(input.faqId),
    projectId: String(input.projectId),
  });
}

export function useDeleteFAQ() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteFAQ,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ipKeys.faqs(String(variables.projectId)) });
    },
  });
}
