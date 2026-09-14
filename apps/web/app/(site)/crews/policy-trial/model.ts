export type DeliveryRule = "project" | "milestone" | "client";
export type RankingRule = "reliability" | "feedback";
export type Settlement = "none" | "pending" | "paid";
export type Scenario = { project: boolean; milestone: boolean; client: boolean };
export const creators = [
  { id: "a", amount: 10000, milestoneAmount: 4000, measured: 10, onTime: 9, feedback: 4.2 },
  { id: "b", amount: 8000, milestoneAmount: 3000, measured: 8, onTime: 6, feedback: 4.8 },
  { id: "c", amount: 6000, milestoneAmount: 2000, measured: 2, onTime: 2, feedback: 4.9 },
] as const;
// Synthetic amounts are integer USD cents. These functions never post real ledger entries.
export function income(rule: DeliveryRule, scenario: Scenario, creator: (typeof creators)[number]) {
  if (rule === "milestone")
    return scenario.project ? creator.amount : scenario.milestone ? creator.milestoneAmount : 0;
  return scenario[rule] ? creator.amount : 0;
}
export function ledger(amount: number, settlement: Settlement) {
  const pending = settlement === "pending" ? amount : 0;
  const paid = settlement === "paid" ? amount : 0;
  return { income: amount, pending, paid, remaining: amount - pending - paid };
}
export function ranked(rule: RankingRule) {
  // Five is a trial threshold, explicitly displayed in the UI; insufficient history stays unranked.
  return [...creators].sort((a, b) => {
    const eligible = Number(b.measured >= 5) - Number(a.measured >= 5);
    return (
      eligible ||
      (rule === "reliability"
        ? b.onTime / b.measured - a.onTime / a.measured
        : b.feedback - a.feedback) ||
      a.id.localeCompare(b.id)
    );
  });
}
export function claimApproved(policy: "one" | "two", approvals: number) {
  return approvals >= (policy === "one" ? 1 : 2);
}
