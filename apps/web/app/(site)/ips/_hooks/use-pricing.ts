/**
 * IP-pricing hooks (mock-backed).
 *
 * `useIpPricing(ipId)` — load the IP's pricing config; falls back to
 *   the seeded default ({freeEpisodeCount: 3, defaultPriceIntegral: 10,
 *   no bundle, no overrides}) until the owner explicitly saves.
 *
 * `useUpdateIpPricing(ipId)` — replace the config in one shot. The
 *   pricing UI keeps a local draft and only calls this on Save, so the
 *   mutation accepts the full IpPricing object rather than per-field
 *   patches.
 *
 * Shape matches the planned wire contract — swap the mock fetcher /
 *   mutator bodies for `api.post(...)` calls once backend ships the
 *   `/vedio/ip/pricing` family. No UI changes needed.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipKeys } from "./shared";
import { readIpPricing, writeIpPricing, type IpPricing } from "./pricing-mock";

export type { IpPricing } from "./pricing-mock";

export function useIpPricing(ipId: string) {
  return useQuery<IpPricing>({
    queryKey: ipKeys.pricing(ipId),
    queryFn: async () => readIpPricing(ipId),
    enabled: !!ipId,
  });
}

export function useUpdateIpPricing(ipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pricing: IpPricing) => writeIpPricing(ipId, pricing),
    onSuccess: (data) => {
      // Optimistic-style sync: write the server-returned canonical
      // state directly into the cache instead of refetching.
      qc.setQueryData(ipKeys.pricing(ipId), data);
    },
  });
}
