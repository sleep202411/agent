"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { CREW_CURRENCY } from "@/src/lib/crew-money";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { crewApi } from "../_hooks/api";
import {
  exactMajorUnits,
  exactMinorUnits,
  useApplicationTerms,
} from "../_hooks/use-application-terms";

export function ApplicationTermsPanel(props: {
  applicationId: string;
  applicantId: string;
  status: string;
  taskLinked?: boolean;
  reviewer?: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const { user } = useCurrentUser();
  return (
    <TermsSession key={`${user?.id}:${props.applicationId}`} {...props} userId={user?.id ?? ""} />
  );
}
function TermsSession({
  applicationId,
  applicantId,
  status,
  taskLinked,
  reviewer,
  onReady,
  userId,
}: Parameters<typeof ApplicationTermsPanel>[0] & { userId: string }) {
  const t = useTranslations("crewTerms");
  const query = useApplicationTerms(applicationId);
  const client = useQueryClient();
  const latest = query.data?.items.find((item) => item.version === query.data?.currentVersion);
  const ready =
    query.isSuccess &&
    !query.isError &&
    ((!taskLinked && query.data.currentVersion === 0) || Boolean(latest?.confirmedAt));
  const [draftVersion, setDraftVersion] = useState<number | null>(null);
  const [scope, setScope] = useState("");
  const [fee, setFee] = useState("");
  const [period, setPeriod] = useState<"month" | "episode" | "project">("project");
  const [share, setShare] = useState("0");
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onReady?.(ready && !busy);
  }, [ready, busy, onReady]);
  const currency = CREW_CURRENCY;
  async function write(confirm: boolean) {
    if (!userId || pending.current || !query.isSuccess || query.isError || status !== "pending")
      return;
    const amount = exactMinorUnits(fee);
    const shareBp = exactMinorUnits(share);
    if (
      !confirm &&
      (!scope.trim() ||
        amount === null ||
        shareBp === null ||
        BigInt(shareBp) > 5000n ||
        (BigInt(shareBp) > 0n && !basis.trim()))
    ) {
      setError(t("invalid"));
      return;
    }
    if (confirm && (!latest || userId !== applicantId)) return;
    if (!confirm && (!reviewer || userId === applicantId || draftVersion === null)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await crewApi.post(
        `/applications/${encodeURIComponent(applicationId)}/terms${confirm ? "/confirm" : ""}`,
        {
          body: confirm
            ? { version: latest!.version }
            : {
                expectedVersion: draftVersion,
                scope: scope.trim(),
                feeAmount: amount,
                currency,
                feePeriod: taskLinked ? "project" : period,
                revenueShareBp: Number(shareBp),
                shareBasis: BigInt(shareBp!) > 0n ? basis.trim() : null,
              },
        }
      );
      await client.invalidateQueries({
        queryKey: ["crew-application-terms", applicationId, userId],
      });
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
      // Do not silently rebase a proposal or consent onto a newer version.
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="space-y-3 px-4 py-3" aria-label={t("title")}>
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      {query.isPending && <p>{t("loading")}</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {(query.isError || error) && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {query.isSuccess && !query.isError && (
        <>
          {!latest ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                {t("version", { version: latest.version })} ·{" "}
                {t(latest.confirmedAt ? "confirmed" : "awaiting")}
              </p>
              <p className="whitespace-pre-wrap">{latest.scope}</p>
              <p>
                {latest.currency} {exactMajorUnits(latest.feeAmount)} / {t(latest.feePeriod)}
              </p>
              <p>
                {t("share")}: {exactMajorUnits(String(latest.revenueShareBp))}%
              </p>
              {latest.shareBasis && <p className="whitespace-pre-wrap">{latest.shareBasis}</p>}
              {status === "pending" && userId === applicantId && !latest.confirmedAt && (
                <Button type="button" disabled={busy} onClick={() => void write(true)}>
                  {t("confirm", { version: latest.version })}
                </Button>
              )}
            </div>
          )}
          {(taskLinked || query.data.currentVersion > 0) && status === "pending" && !ready && (
            <p className="text-sm text-muted-foreground">{t("blocked")}</p>
          )}
          {reviewer && userId !== applicantId && status === "pending" && (
            <details
              onToggle={(event) => {
                if (event.currentTarget.open) setDraftVersion(query.data.currentVersion);
              }}
            >
              <summary className="cursor-pointer text-sm">{t("propose")}</summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void write(false);
                }}
              >
                <label className="block text-sm">
                  {t("scope")}
                  <Textarea
                    className="block w-full rounded bg-muted p-2"
                    required
                    maxLength={10000}
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  {t("fee")} ({currency})
                  <Input
                    className="block w-full rounded bg-muted p-2"
                    inputMode="decimal"
                    required
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  {t("period")}
                  <NativeSelect
                    aria-label={t("period")}
                    className="block w-full rounded bg-muted p-2"
                    value={taskLinked ? "project" : period}
                    disabled={taskLinked}
                    onChange={(value) => setPeriod(value as typeof period)}
                  >
                    {(["project", "episode", "month"] as const).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t(value)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label className="block text-sm">
                  {t("share")} (%)
                  <Input
                    className="block w-full rounded bg-muted p-2"
                    inputMode="decimal"
                    value={share}
                    onChange={(e) => setShare(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  {t("basis")}
                  <Textarea
                    className="block w-full rounded bg-muted p-2"
                    maxLength={5000}
                    value={basis}
                    onChange={(e) => setBasis(e.target.value)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">{t("noPayment")}</p>
                <Button type="submit" disabled={busy}>
                  {t("propose")}
                </Button>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}
