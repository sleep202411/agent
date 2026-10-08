import { listAdminDirectoryModules } from "../nav-config";

export const SYSTEM_ROLE_KEYS = new Set(["super_admin", "admin", "operations"]);

export const RETIRED_ADMIN_ROLE_KEYS = new Set(["master_financial_controller"]);

export function isRetiredRoleKey(key: string) {
  return RETIRED_ADMIN_ROLE_KEYS.has(key);
}

export const SYSTEM_ROLE_DISPLAY: Record<string, { name: string; description: string }> = {
  super_admin: { name: "超级管理员", description: "后台账号、安全策略、审计和全部运营权限" },
  admin: { name: "普通管理员", description: "内容、账单、媒体和审计权限，不管理后台账号" },
  operations: { name: "运营", description: "日常内容与运营权限" },
};

export function displayRoleName(role: { key: string; name: string }) {
  return SYSTEM_ROLE_DISPLAY[role.key]?.name ?? role.name;
}

export function displayRoleDescription(role: { key: string; description: string }) {
  return SYSTEM_ROLE_DISPLAY[role.key]?.description ?? role.description;
}

export type PermissionTreeNode = {
  id: string;
  label: string;
  permissionKey?: string;
  children?: PermissionTreeNode[];
};

const ACTION_LABELS: Record<string, string> = {
  read: "查看",
  write: "编辑",
  manage: "管理",
  publish: "发布",
  moderate: "审核",
  review: "审批",
};

export function isSystemRoleKey(key: string) {
  return SYSTEM_ROLE_KEYS.has(key);
}

export function permissionFamily(key: string) {
  const index = key.lastIndexOf(".");
  return index === -1 ? key : key.slice(0, index);
}

export function collectPermissionKeys(node: PermissionTreeNode): string[] {
  if (node.children?.length) {
    return [...new Set(node.children.flatMap(collectPermissionKeys))];
  }
  const key = node.permissionKey ?? (node.id.includes(".") ? node.id : "");
  return key ? [key] : [];
}

export function flattenPermissionLeaves(nodes: PermissionTreeNode[]): PermissionTreeNode[] {
  return nodes.flatMap((node) =>
    node.children?.length ? flattenPermissionLeaves(node.children) : [node]
  );
}

export function filterPermissionTree(
  nodes: PermissionTreeNode[],
  available: Set<string>
): PermissionTreeNode[] {
  return nodes
    .map((node) => {
      if (!node.children?.length) {
        const key = node.permissionKey ?? node.id;
        return available.has(key) ? node : null;
      }
      const children = filterPermissionTree(node.children, available);
      return children.length ? { ...node, children } : null;
    })
    .filter((node): node is PermissionTreeNode => Boolean(node));
}

const DEDICATED_MODULE_PERMISSIONS: Record<string, string[]> = {
  "/ai-actors": ["ai_actors.read", "ai_actors.write"],
};

export function dedicatedPermissionKeys() {
  return Object.values(DEDICATED_MODULE_PERMISSIONS).flat();
}

/** Build the create-role tree from the live admin nav + the current permission catalog. */
export function buildAssignablePermissionTree(
  available: Set<string>,
  labels?: Map<string, string>
): PermissionTreeNode[] {
  const catalog = new Set(available);
  for (const key of dedicatedPermissionKeys()) catalog.add(key);
  const modules = listAdminDirectoryModules();
  const otherSlugs = new Set(modules.map((module) => navSlug(module.id)));
  const used = new Set<string>();
  const tree: PermissionTreeNode[] = [];

  for (const module of modules) {
    const keys = keysForModule(module, catalog, otherSlugs);
    if (!keys.length) continue;
    keys.forEach((key) => used.add(key));
    tree.push({
      id: module.id,
      label: module.label,
      children: childrenForModule(module, keys),
    });
  }

  const leftover = [...available].filter((key) => !used.has(key));
  if (leftover.length) {
    tree.push({
      id: "other",
      label: "其他",
      children: leftover.map((id) => ({
        id,
        permissionKey: id,
        label: labels?.get(id) ?? actionLabel(id),
      })),
    });
  }
  return tree;
}

function navSlug(moduleId: string) {
  return moduleId.replace(/^\//, "").replace(/-/g, "_");
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function actionLabel(key: string) {
  const action = key.split(".").pop() ?? key;
  return ACTION_LABELS[action] ?? key;
}

function keysForModule(
  module: ReturnType<typeof listAdminDirectoryModules>[number],
  catalog: Set<string>,
  otherSlugs: Set<string>
) {
  const dedicated = DEDICATED_MODULE_PERMISSIONS[module.id];
  if (dedicated) return dedicated.filter((key) => catalog.has(key));

  const slug = navSlug(module.id);
  const hinted = unique(
    [
      module.permission,
      ...module.groups.flatMap((group) => group.pages.map((page) => page.permission)),
    ].filter((key): key is string => Boolean(key))
  );
  const own = [...catalog].filter((key) => permissionFamily(key) === slug);
  if (own.length) {
    return unique([
      ...own,
      ...hinted.filter(
        (key) =>
          catalog.has(key) &&
          permissionFamily(key) !== slug &&
          !otherSlugs.has(permissionFamily(key))
      ),
    ]);
  }

  const keys: string[] = [];
  for (const hint of hinted) {
    const family = permissionFamily(hint);
    if (otherSlugs.has(family) && family !== slug) {
      if (catalog.has(hint)) keys.push(hint);
      continue;
    }
    keys.push(...[...catalog].filter((key) => permissionFamily(key) === family));
  }
  return unique(keys);
}

function childrenForModule(
  module: ReturnType<typeof listAdminDirectoryModules>[number],
  keys: string[]
): PermissionTreeNode[] {
  const usedOnPages = new Set<string>();
  const children: PermissionTreeNode[] = [];

  for (const group of module.groups) {
    const pages = group.pages.filter((page) => page.permission && keys.includes(page.permission));
    if (!pages.length) continue;
    children.push({
      id: group.id,
      label: group.label,
      children: pages.map((page) => ({
        id: page.id,
        label: page.label,
        permissionKey: page.permission,
      })),
    });
    pages.forEach((page) => {
      if (page.permission) usedOnPages.add(page.permission);
    });
  }

  const extras = keys.filter((key) => !usedOnPages.has(key));
  children.push(
    ...extras.map((id) => ({
      id,
      permissionKey: id,
      label: actionLabel(id),
    }))
  );
  return children;
}
