import { expect, it } from "vitest";
import { grantsAdminAccess } from "@/lib/admin-capability";
import {
  GLOBAL_NAV,
  MODULE_NAV,
  activeModule,
  moduleLandingHref,
  moduleNavVisible,
} from "./nav-config";

it("keeps crew finance pages inside 剧组管理 instead of the left rail", () => {
  expect(GLOBAL_NAV.map((entry) => entry.key)).not.toEqual(
    expect.arrayContaining(["/withdrawals", "/task-payments", "/revenue"])
  );
  const crewHrefs = MODULE_NAV["/crews"].flatMap((group) => group.items.map((item) => item.href));
  expect(crewHrefs).toEqual(expect.arrayContaining(["/revenue", "/task-payments", "/withdrawals"]));
});

it("treats crew finance URLs as the 剧组管理 module", () => {
  expect(activeModule("/revenue")).toBe("/crews");
  expect(activeModule("/task-payments")).toBe("/crews");
  expect(activeModule("/withdrawals")).toBe("/crews");
  expect(activeModule("/crews/positions")).toBe("/crews");
});

it("keeps AI演员 on the left rail", () => {
  expect(GLOBAL_NAV.map((entry) => entry.key)).toContain("/ai-actors");
  expect(GLOBAL_NAV.find((entry) => entry.key === "/ai-actors")?.permission).toBe("ai_actors.read");
});

it("lets super_admin see AI演员 before the role is backfilled", () => {
  const actors = GLOBAL_NAV.find((entry) => entry.key === "/ai-actors")!;
  expect(
    moduleNavVisible(actors, (permission) =>
      grantsAdminAccess({ roleKeys: ["super_admin"], permissions: [] }, permission)
    )
  ).toBe(true);
});

it("shows 剧组管理 when the operator only has revenue permission", () => {
  const crews = GLOBAL_NAV.find((entry) => entry.key === "/crews")!;
  expect(moduleNavVisible(crews, (permission) => permission === "creator.revenue.manage")).toBe(
    true
  );
  expect(moduleLandingHref(crews, (permission) => permission === "creator.revenue.manage")).toBe(
    "/revenue"
  );
});

it("hides 用户管理 when the operator only has billing permission", () => {
  const members = GLOBAL_NAV.find((entry) => entry.key === "/members")!;
  expect(moduleNavVisible(members, (permission) => permission === "billing.read")).toBe(false);
  expect(
    MODULE_NAV["/members"].flatMap((group) => group.items).map((item) => item.permission)
  ).toEqual(["user.read", "user.read", "user.read"]);
});

it("shows 用户管理 when the operator has user.read", () => {
  const members = GLOBAL_NAV.find((entry) => entry.key === "/members")!;
  expect(moduleNavVisible(members, (permission) => permission === "user.read")).toBe(true);
  expect(moduleLandingHref(members, (permission) => permission === "user.read")).toBe(
    "/members/directory"
  );
});
