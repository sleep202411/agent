"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchCreatorCertificates,
  type CreatorCertificate,
  type CreatorCertificatesApiError,
} from "@/app/(site)/creators/_data/certificates";

export const creatorCertificateKeys = {
  all: ["creator-certificates"] as const,
  list: (creatorId: string) => ["creator-certificates", "list", creatorId] as const,
};

export function useCreatorCertificates(creatorId: string) {
  return useQuery<CreatorCertificate[], CreatorCertificatesApiError>({
    queryKey: creatorCertificateKeys.list(String(creatorId)),
    queryFn: () => fetchCreatorCertificates(creatorId),
    enabled: Boolean(creatorId),
    staleTime: 60_000,
  });
}
