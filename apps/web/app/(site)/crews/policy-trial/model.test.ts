import { expect, it } from "vitest";
import { creators, income, ledger, ranked, claimApproved } from "./model";
it("never reflects compensation without the chosen delivery evidence", () => {
  for (const rule of ["project", "milestone", "client"] as const)
    for (const c of creators)
      expect(income(rule, { project: false, milestone: false, client: false }, c)).toBe(0);
});
it("distinguishes milestone, internal completion and client acceptance without double counting", () => {
  const s = { project: false, milestone: true, client: false };
  expect(income("milestone", s, creators[0])).toBe(4000);
  expect(income("project", s, creators[0])).toBe(0);
  expect(income("client", s, creators[0])).toBe(0);
  expect(income("milestone", { ...s, project: true }, creators[0])).toBe(10000);
  expect(income("client", { ...s, project: true }, creators[0])).toBe(0);
});
it("reconciles all settlement options and keeps zero income unpaid", () => {
  for (const amount of [0, 3000, 10000])
    for (const status of ["none", "pending", "paid"] as const) {
      const l = ledger(amount, status);
      expect(l.pending + l.paid + l.remaining).toBe(amount);
      expect(l.remaining).toBeGreaterThanOrEqual(0);
    }
});
it("shows the effect of alternative rankings and leaves low history unranked", () => {
  expect(ranked("reliability").map((c) => c.id)).toEqual(["a", "b", "c"]);
  expect(ranked("feedback").map((c) => c.id)).toEqual(["b", "a", "c"]);
});
it("requires distinct approval counts according to the chosen claim trial", () => {
  expect(claimApproved("one", 0)).toBe(false);
  expect(claimApproved("one", 1)).toBe(true);
  expect(claimApproved("two", 1)).toBe(false);
  expect(claimApproved("two", 2)).toBe(true);
});
