"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { crewApi } from "../_hooks/api";
import { exactMajorUnits } from "../_hooks/use-application-terms";
import { Button } from "@/components/ui/button";

export function TaskAgreedFee({
  taskId,
  userId,
  onUse,
}: {
  taskId: string;
  userId: string;
  onUse: (currency: "USD" | "CNY", fee: string) => void;
}) {
  const { user } = useCurrentUser();
  const t = useTranslations("crewTerms");
  const query = useQuery({
    queryKey: ["task-agreed-fee", taskId, userId, user?.id],
    enabled: Boolean(user),
    retry: false,
    queryFn: ({ signal }) =>
      crewApi.get<{
        required: boolean;
        items: { version: number; currency: "USD" | "CNY"; feeAmount: string }[];
      }>(`/crew-tasks/${encodeURIComponent(taskId)}/recruitment-terms`, {
        query: { applicantId: userId },
        signal,
        cache: "no-store",
      }),
  });
  if (query.isError)
    return (
      <div className="col-span-3 text-xs" role="alert">
        {query.error.message}
        <Button onClick={() => void query.refetch()}>{t("refresh")}</Button>
      </div>
    );
  if (query.isPending) return <p className="col-span-3 text-xs">{t("loading")}</p>;
  if (!query.data?.required) return null;
  return (
    <div className="col-span-3 space-y-1 text-xs">
      {query.data.items.length === 0 ? (
        <p>{t("noAgreement")}</p>
      ) : (
        query.data.items.map((item, index) => (
          <div key={`${item.version}:${index}`}>
            <p>
              {t("agreedFee")}: {item.currency} {exactMajorUnits(item.feeAmount)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => onUse(item.currency, exactMajorUnits(item.feeAmount))}
            >
              {t("useFee")}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
