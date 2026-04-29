/**
 * FAQ CRUD (P1).
 *
 *   - `useFAQs`        — POST /project/faq/query
 *   - `useCreateFAQ`   — POST /project/faq/create
 *   - `useUpdateFAQ`   — POST /project/faq/update
 *   - `useDeleteFAQ`   — POST /project/faq/delete
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptLanguage, bearerHeader, ipKeys } from "./shared";
import type { FAQ } from "./types";

async function fetchFAQs(projectId: string): Promise<FAQ[]> {
  const res = await fetch("/project/faq/query", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({ projectId: Number(projectId) }),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { code: number; data: { list: FAQ[] } | FAQ[] };
  if (Array.isArray(json.data)) return json.data;
  return json.data?.list ?? [];
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

async function createFAQ(input: CreateFAQInput): Promise<{ id: number }> {
  const res = await fetch("/project/faq/create", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Create FAQ failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string; data: { id: number } };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Create FAQ failed");
  }
  return json.data;
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
  id: number;
  /** Used only for cache invalidation; not part of the backend payload. */
  projectId: number;
  question?: string;
  answer?: string;
  sort?: number;
}

async function updateFAQ(input: UpdateFAQInput): Promise<void> {
  const { projectId: _projectId, ...payload } = input;
  void _projectId;
  const res = await fetch("/project/faq/update", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update FAQ failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Update FAQ failed");
  }
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
  id: number;
  /** Used only for cache invalidation. */
  projectId: number;
}

async function deleteFAQ(input: DeleteFAQInput): Promise<void> {
  const res = await fetch("/project/faq/delete", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "accept-language": acceptLanguage(),
      Authorization: bearerHeader(),
    },
    body: JSON.stringify({ id: input.id }),
  });
  if (!res.ok) throw new Error(`Delete FAQ failed: HTTP ${res.status}`);
  const json = (await res.json()) as { code: number; msg?: string };
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || "Delete FAQ failed");
  }
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
