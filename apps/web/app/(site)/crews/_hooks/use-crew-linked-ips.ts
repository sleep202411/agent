import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
export function useCrewLinkedIps(crewId: string, enabled = true) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["crew-linked-ips", crewId, user?.id ?? null],
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await crewApi.get<{
        code: number;
        msg?: string;
        data: { items: { id: string }[] };
      }>(`/ip-commerce/crews/${encodeURIComponent(crewId)}/ips`, { signal, cache: "no-store" });
      if (result.code !== 200) throw new Error(result.msg || `IP error ${result.code}`);
      return result.data.items;
    },
  });
}
