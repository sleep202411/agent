/**
 * FAQ CRUD.
 *
 *   - `useFAQs`        — GET  /project/faq/list?projectId=
 *   - `useCreateFAQ`   — POST /project/faq/add (JSON body)
 *   - `useUpdateFAQ`   — POST /project/faq/update (JSON body, field is `id` not `faqId`)
 *   - `useDeleteFAQ`   — POST /project/faq/delete (query params)
 *
 * `add` and `update` migrated to `@RequestBody` on the Java side;
 * `delete` still declares its fields as `(query)` in Swagger.
 * Authorization header is preserved on top of the cookie because
 * legacy IP-feature controllers NPE without it.
 *
 * The backend identifier is **`faqId`** (int64) — not `id`. Update and
 * delete both require `faqId` AND `projectId`. Update additionally
 * requires the full `question` + `answer` (no partial patches), so
 * call sites pass the merged values, not just the changed field.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { bearerHeader, ipKeys } from "./shared";
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
  const data = await api.get<WireFAQ[] | { list?: WireFAQ[] } | null>("/project/faq/list", {
    params: { projectId },
    headers: { Authorization: bearerHeader() },
  });
  const rows = Array.isArray(data) ? data : (data?.list ?? []);
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
  const result = await api.post<{ faqId?: number; id?: number } | number | null>(
    "/project/faq/add",
    {
      data: {
        projectId: input.projectId,
        question: input.question,
        answer: input.answer,
        sort: input.sort,
      },
      headers: { Authorization: bearerHeader() },
    }
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
  await api.post("/project/faq/update", {
    data: {
      id: input.faqId,
      projectId: input.projectId,
      question: input.question,
      answer: input.answer,
      sort: input.sort,
    },
    headers: { Authorization: bearerHeader() },
  });
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
  await api.post("/project/faq/delete", {
    params: {
      faqId: input.faqId,
      projectId: input.projectId,
    },
    headers: { Authorization: bearerHeader() },
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
