import { expect, it } from "vitest";
import {
  buildAssignablePermissionTree,
  collectPermissionKeys,
  displayRoleName,
  flattenPermissionLeaves,
  isRetiredRoleKey,
  isSystemRoleKey,
} from "./permission-tree";

const CATALOG = new Set([
  "courses.read",
  "courses.write",
  "news.read",
  "media.read",
  "media.write",
  "ai_actors.read",
  "ai_actors.write",
  "billing.read",
  "billing.write",
  "workspace.read",
  "mystery.operate",
]);

it("builds one folder per live admin directory, not a hardcoded grouping", () => {
  const tree = buildAssignablePermissionTree(CATALOG);
  const ids = tree.map((node) => node.id);
  expect(ids).toContain("/courses");
  expect(ids).toContain("/news");
  expect(ids).toContain("/ai-actors");
  expect(ids).toContain("/media");
  expect(ids).toContain("/billing");
  expect(ids).toContain("/growth");
  expect(ids).not.toContain("content");
  expect(tree.find((node) => node.id === "/courses")?.label).toBe("课程管理");
});

it("keeps AI演员 on its own keys and 媒体资产 on media keys", () => {
  const tree = buildAssignablePermissionTree(CATALOG);
  const actors = flattenPermissionLeaves(tree.filter((node) => node.id === "/ai-actors"));
  const media = flattenPermissionLeaves(tree.filter((node) => node.id === "/media"));
  expect(actors.map((node) => node.permissionKey ?? node.id).sort()).toEqual([
    "ai_actors.read",
    "ai_actors.write",
  ]);
  expect([...new Set(media.map((node) => node.permissionKey ?? node.id))].sort()).toEqual([
    "media.read",
    "media.write",
  ]);
});

it("never borrows media permissions into AI演员", () => {
  const tree = buildAssignablePermissionTree(new Set(["media.read", "media.write"]));
  const actors = flattenPermissionLeaves(tree.filter((node) => node.id === "/ai-actors"));
  const media = flattenPermissionLeaves(tree.filter((node) => node.id === "/media"));
  expect(actors.map((node) => node.permissionKey ?? node.id).sort()).toEqual([
    "ai_actors.read",
    "ai_actors.write",
  ]);
  expect(actors.map((node) => node.label).sort()).toEqual(["查看", "编辑"]);
  expect([...new Set(media.map((node) => node.permissionKey ?? node.id))].sort()).toEqual([
    "media.read",
    "media.write",
  ]);
});

it("puts unmapped catalog keys under 其他", () => {
  const tree = buildAssignablePermissionTree(
    new Set(["workspace.read", "mystery.operate"]),
    new Map([["mystery.operate", "未知权限"]])
  );
  const other = tree.find((node) => node.id === "other")!;
  expect(
    flattenPermissionLeaves([other])
      .map((node) => node.id)
      .sort()
  ).toEqual(["mystery.operate", "workspace.read"]);
});

it("collects unique keys for a folder select-all", () => {
  const tree = buildAssignablePermissionTree(new Set(["news.read", "news.write"]));
  const news = tree.find((node) => node.id === "/news")!;
  expect(collectPermissionKeys(news).sort()).toEqual(["news.read", "news.write"]);
});

it("treats catalog roles as system even without an API flag", () => {
  expect(isSystemRoleKey("super_admin")).toBe(true);
  expect(isSystemRoleKey("operations")).toBe(true);
  expect(isSystemRoleKey("wardrobe")).toBe(false);
});

it("hides retired catalog roles from account assignment", () => {
  expect(isRetiredRoleKey("master_financial_controller")).toBe(true);
  expect(isRetiredRoleKey("operations")).toBe(false);
});

it("shows a Chinese label for catalog roles", () => {
  expect(displayRoleName({ key: "operations", name: "Operations" })).toBe("运营");
});
