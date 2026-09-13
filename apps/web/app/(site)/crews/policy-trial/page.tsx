"use client";
import { useState } from "react";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import {
  creators,
  income,
  ledger,
  ranked,
  claimApproved,
  type DeliveryRule,
  type RankingRule,
  type Settlement,
  type Scenario,
} from "./model";

export default function CrewPolicyTrial() {
  const t = useTranslations("crewPolicyTrial");
  const locale = useLocale();
  const [rule, setRule] = useState<DeliveryRule>("project");
  const [scenario, setScenario] = useState<Scenario>({
    project: false,
    milestone: false,
    client: false,
  });
  const [view, setView] = useState("creator");
  const [creatorId, setCreatorId] = useState("a");
  const [settlement, setSettlement] = useState<Settlement>("none");
  const [ranking, setRanking] = useState<RankingRule>("reliability");
  const [claimPolicy, setClaimPolicy] = useState<"one" | "two">("one");
  const [approvals, setApprovals] = useState(0);
  const [reimbursed, setReimbursed] = useState(false);
  const money = (amount: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount / 100);
  const rows = creators.filter((c) => view === "admin" || c.id === creatorId);
  const totals = rows
    .map((c) => ledger(income(rule, scenario, c), settlement))
    .reduce(
      (a, b) => ({
        income: a.income + b.income,
        pending: a.pending + b.pending,
        paid: a.paid + b.paid,
        remaining: a.remaining + b.remaining,
      }),
      { income: 0, pending: 0, paid: 0, remaining: 0 }
    );
  const approved = claimApproved(claimPolicy, approvals);
  const selectClass = "rounded-md border border-border bg-background p-2 text-sm";
  function reset() {
    setRule("project");
    setScenario({ project: false, milestone: false, client: false });
    setView("creator");
    setCreatorId("a");
    setSettlement("none");
    setRanking("reliability");
    setClaimPolicy("one");
    setApprovals(0);
    setReimbursed(false);
  }
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p role="note" className="rounded-lg bg-muted p-4">
          {t("notice")}
        </p>
        <Button variant="outline" onClick={reset}>
          {t("reset")}
        </Button>
      </header>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{t("incomeTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("incomeHelp")}</p>
        <div className="flex flex-wrap gap-4">
          <label className="grid gap-1">
            {t("rule")}
            <NativeSelect
              className={selectClass}
              value={rule}
              onChange={(e) => setRule(e as DeliveryRule)}
            >
              {(["project", "milestone", "client"] as const).map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {t(v)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1">
            {t("view")}
            <NativeSelect className={selectClass} value={view} onChange={(e) => setView(e)}>
              <NativeSelectOption value="creator">{t("creatorView")}</NativeSelectOption>
              <NativeSelectOption value="admin">{t("adminView")}</NativeSelectOption>
            </NativeSelect>
          </label>
          {view === "creator" && (
            <label className="grid gap-1">
              {t("creator")}
              <NativeSelect
                className={selectClass}
                value={creatorId}
                onChange={(e) => setCreatorId(e)}
              >
                {creators.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {t(c.id)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          <label className="grid gap-1">
            {t("settlement")}
            <NativeSelect
              className={selectClass}
              value={settlement}
              onChange={(e) => setSettlement(e as Settlement)}
            >
              {(["none", "pending", "paid"] as const).map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {t(v)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-2 font-medium">{t("events")}</legend>
          {(["project", "milestone", "client"] as const).map((v) => (
            <label className="flex items-center gap-2" key={v}>
              <input
                type="checkbox"
                checked={scenario[v]}
                onChange={(e) => setScenario((s) => ({ ...s, [v]: e.target.checked }))}
              />
              {t(v)}
            </label>
          ))}
        </fieldset>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="py-2 text-left text-muted-foreground">{t("amountHelp")}</caption>
            <thead>
              <tr>
                {["creator", "agreed", "income", "pending", "paid", "remaining"].map((k) => (
                  <th className="p-2" key={k}>
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const l = ledger(income(rule, scenario, c), settlement);
                return (
                  <tr key={c.id} className="border-t border-border">
                    <th className="p-2 font-normal">{t(c.id)}</th>
                    <td className="p-2">{money(c.amount)}</td>
                    {(["income", "pending", "paid", "remaining"] as const).map((k) => (
                      <td key={k} className="p-2">
                        {money(l[k])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <th className="p-2" colSpan={2}>
                  {t("total")}
                </th>
                {(["income", "pending", "paid", "remaining"] as const).map((k) => (
                  <td className="p-2" key={k}>
                    {money(totals[k])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("costTitle")}</h2>
        <p>{t("fdHelp")}</p>
        <p>
          {t("travel")}: {money(2000)}
        </p>
        <label className="grid gap-1">
          {t("claimPolicy")}
          <NativeSelect
            className={selectClass}
            value={claimPolicy}
            onChange={(e) => setClaimPolicy(e as "one" | "two")}
          >
            <NativeSelectOption value="one">{t("one")}</NativeSelectOption>
            <NativeSelectOption value="two">{t("two")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="grid gap-1">
          {t("approvals")}
          <NativeSelect
            className={selectClass}
            value={String(approvals)}
            onChange={(e) => setApprovals(Number(e))}
          >
            {[0, 1, 2].map((v) => (
              <NativeSelectOption key={v} value={String(v)}>
                {v}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={reimbursed}
            onChange={(e) => setReimbursed(e.target.checked)}
          />
          {t("reimbursed")}
        </label>
        <p role="status">
          {t(approved ? (reimbursed ? "claimPaid" : "claimApproved") : "claimPending")}
        </p>
        <p className="text-sm text-muted-foreground">{t("costHelp")}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("rankingTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("rankingHelp")}</p>
        <label className="grid gap-1">
          {t("rankingRule")}
          <NativeSelect
            className={selectClass}
            value={ranking}
            onChange={(e) => setRanking(e as RankingRule)}
          >
            <NativeSelectOption value="reliability">{t("reliability")}</NativeSelectOption>
            <NativeSelectOption value="feedback">{t("feedback")}</NativeSelectOption>
          </NativeSelect>
        </label>
        <ul className="space-y-2">
          {ranked(ranking).map((c, i) => (
            <li key={c.id} className="rounded-md bg-muted p-3">
              {c.measured >= 5 ? `${i + 1}. ` : `${t("unranked")} · `}
              {t(c.id)} · {t("reliability")}: {c.onTime}/{c.measured} · {t("feedback")}:{" "}
              {c.feedback}/5
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-muted-foreground">{t("decisionHelp")}</p>
    </main>
  );
}
