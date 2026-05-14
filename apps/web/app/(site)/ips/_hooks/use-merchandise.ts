/**
 * IP merchandise hooks (mock-backed).
 *
 * Hook signatures mirror the planned wire contract so the day backend
 * ships the matching endpoints, swapping the fetcher / mutator bodies
 * for `api.post(...)` calls is the only change. UI code below this
 * layer doesn't change.
 *
 *   useIpMerchandise(ipId)              — list SKUs for one IP
 *   useCreateMerchandise(ipId)          — append a new SKU
 *   useUpdateMerchandise(ipId)          — edit any field
 *   useDeleteMerchandise(ipId)          — remove a SKU
 *   useToggleMerchandiseStatus(ipId)    — flip listed/draft/offline
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipKeys } from "./shared";
import {
  createMerchandise,
  deleteMerchandise,
  listMerchandise,
  updateMerchandise,
  type CreateMerchandiseInput,
  type MerchandiseSku,
  type MerchandiseStatus,
} from "./merchandise-mock";

export type {
  MerchandiseSku,
  MerchandiseKind,
  MerchandiseCurrency,
  MerchandiseStatus,
  CreateMerchandiseInput,
} from "./merchandise-mock";
export { DEFAULT_COGS_BY_KIND } from "./merchandise-mock";

export function useIpMerchandise(ipId: string) {
  return useQuery<MerchandiseSku[]>({
    queryKey: ipKeys.merchandise(ipId),
    queryFn: async () => listMerchandise(ipId),
    enabled: !!ipId,
  });
}

export function useCreateMerchandise(ipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateMerchandiseInput, "ipId">) =>
      createMerchandise({ ipId, ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ipKeys.merchandise(ipId) });
    },
  });
}

export function useUpdateMerchandise(ipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Omit<MerchandiseSku, "id" | "ipId" | "createdAt" | "updatedAt">>;
    }) => updateMerchandise({ ipId, id: input.id, patch: input.patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ipKeys.merchandise(ipId) });
    },
  });
}

export function useDeleteMerchandise(ipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      deleteMerchandise(ipId, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ipKeys.merchandise(ipId) });
    },
  });
}

export function useToggleMerchandiseStatus(ipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: MerchandiseStatus }) =>
      updateMerchandise({ ipId, id: input.id, patch: { status: input.status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ipKeys.merchandise(ipId) });
    },
  });
}
