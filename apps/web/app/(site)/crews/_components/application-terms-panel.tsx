"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
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
  acceptOffer?: boolean;
  taskTitle?: string;
  dueAt?: string | null;
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
  acceptOffer,
  taskTitle,
  dueAt,
  reviewer,
  onReady,
  userId,
}: Parameters<typeof ApplicationTermsPanel>[0] & { userId: string }) {
  const t = useTranslations("crewTerms");
  const locale = useLocale();
  const query = useApplicationTerms(applicationId);
  const client = useQueryClient();
  const latest = query.data?.items.find((item) => item.version === query.data?.currentVersion);
  const ready = query.isSuccess && !query.isError && Boolean(latest?.confirmedAt);
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
        `/applications/${encodeURIComponent(applicationId)}${confirm && acceptOffer ? "/accept-offer" : `/terms${confirm ? "/confirm" : ""}`}`,
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
      if (confirm && acceptOffer) {
        await Promise.all([
          client.invalidateQueries({ queryKey: ["recruitment-thread", userId, applicationId] }),
          client.invalidateQueries({ queryKey: ["my-crew-applications", userId] }),
          client.invalidateQueries({ queryKey: ["crew"] }),
        ]);
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : t("failed"));
      // Do not silently rebase a proposal or consent onto a newer version.
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className={
        acceptOffer && latest && !query.isError
          ? "space-y-3 overflow-hidden rounded-lg bg-white/5 p-4"
          : "space-y-3 px-4 py-3"
      }
      aria-label={t("title")}
    >
      {(!acceptOffer || latest) && (
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
      )}
      {taskTitle && latest && !query.isError && (
        <h4 className="text-base font-semibold">{taskTitle}</h4>
      )}
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
            !acceptOffer ? (
              <p className="text-sm text-muted-foreground">{t("none")}</p>
            ) : null
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                {t("version", { version: latest.version })} ·{" "}
                {t(latest.confirmedAt ? "confirmed" : "awaiting")}
              </p>
              <p className="whitespace-pre-wrap">{latest.scope}</p>
              <dl className="grid grid-cols-1 gap-4 border-y border-white/10 py-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("fee")}</dt>
                  <dd className="mt-1 text-base font-semibold">
                    {latest.currency} {exactMajorUnits(latest.feeAmount)}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t(latest.feePeriod)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("share")}</dt>
                  <dd className="mt-1 text-base font-semibold">
                    {exactMajorUnits(String(latest.revenueShareBp))}%
                  </dd>
                </div>
                {dueAt && (
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("taskDeadline")}</dt>
                    <dd className="mt-1 text-base font-semibold">
                      {new Date(dueAt).toLocaleDateString(locale)}
                    </dd>
                  </div>
                )}
              </dl>
              {latest.shareBasis && <p className="whitespace-pre-wrap">{latest.shareBasis}</p>}
              {status === "pending" &&
                userId === applicantId &&
                (!latest.confirmedAt || acceptOffer) && (
                  <Button type="button" disabled={busy} onClick={() => void write(true)}>
                    {acceptOffer ? t("acceptOffer") : t("confirm", { version: latest.version })}
                  </Button>
                )}
            </div>
          )}
          {!acceptOffer && status === "pending" && !ready && (
            <p className="text-sm text-muted-foreground">{t("blocked")}</p>
          )}
          {reviewer && userId !== applicantId && status === "pending" && (
            <details
              onToggle={(event) => {
                if (event.currentTarget.open)
                  setDraftVersion((version) => version ?? query.data.currentVersion);
              }}
            >
              <summary className="cursor-pointer text-sm">
                {t(latest ? "reviseOffer" : "createOffer")}
              </summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void write(false);
                }}
              >
                {(scope || fee || share !== "0" || basis) && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (pending.current) return;
                      setScope("");
                      setFee("");
                      setPeriod("project");
                      setShare("0");
                      setBasis("");
                      setError("");
                      setDraftVersion(query.data.currentVersion);
                    }}
                  >
                    {t("discardDraft")}
                  </Button>
                )}
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
