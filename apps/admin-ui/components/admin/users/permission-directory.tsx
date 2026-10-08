"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import {
  buildAssignablePermissionTree,
  collectPermissionKeys,
  dedicatedPermissionKeys,
  type PermissionTreeNode,
} from "./permission-tree";
import type { AdminPermissionInfo } from "./types";

export function PermissionDirectory({
  permissions,
  selected,
  onChange,
  readOnly = false,
}: {
  permissions: AdminPermissionInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
  readOnly?: boolean;
}) {
  const catalog = useMemo(() => {
    const keys = new Set(permissions.map((item) => item.key));
    for (const key of dedicatedPermissionKeys()) keys.add(key);
    return keys;
  }, [permissions]);
  const assignable = useMemo(() => {
    const keys = new Set(
      permissions.filter((item) => item.assignable !== false).map((item) => item.key)
    );
    const blocked = new Set(
      permissions.filter((item) => item.assignable === false).map((item) => item.key)
    );
    for (const key of dedicatedPermissionKeys()) {
      if (!blocked.has(key)) keys.add(key);
    }
    return keys;
  }, [permissions]);
  const tree = useMemo(
    () =>
      buildAssignablePermissionTree(
        catalog,
        new Map(permissions.map((item) => [item.key, item.description]))
      ),
    [catalog, permissions]
  );

  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!tree.length) {
    return <p className="text-sm text-slate-500">当前没有可分配的权限。</p>;
  }

  return (
    <div className="rounded-lg border border-slate-200">
      {tree.map((node) => (
        <DirectoryNode
          key={node.id}
          node={node}
          depth={0}
          assignable={assignable}
          selected={selected}
          readOnly={readOnly}
          open={open}
          onToggleOpen={(id) => setOpen((current) => ({ ...current, [id]: !current[id] }))}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function DirectoryNode({
  node,
  depth,
  assignable,
  selected,
  readOnly,
  open,
  onToggleOpen,
  onChange,
}: {
  node: PermissionTreeNode;
  depth: number;
  assignable: Set<string>;
  selected: string[];
  readOnly: boolean;
  open: Record<string, boolean>;
  onToggleOpen: (id: string) => void;
  onChange: (next: string[]) => void;
}) {
  const allKeys = collectPermissionKeys(node);
  const keys = readOnly ? allKeys : allKeys.filter((key) => assignable.has(key));
  const isLeaf = !node.children?.length;
  const leafKey = node.permissionKey ?? node.id;
  const selectedCount = keys.filter((key) => selected.includes(key)).length;
  const allOn = keys.length > 0 && selectedCount === keys.length;
  const someOn = selectedCount > 0 && !allOn;
  const expanded = open[node.id] ?? depth > 0;

  function toggleKeys(nextOn: boolean) {
    const keep = selected.filter((key) => !keys.includes(key));
    onChange(nextOn ? [...keep, ...keys] : keep);
  }

  if (isLeaf) {
    const canAssign = !readOnly && assignable.has(leafKey);
    return (
      <label
        className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50/80"
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <input
          type="checkbox"
          aria-label={leafKey}
          className="size-4 accent-slate-900 disabled:opacity-40"
          checked={selected.includes(leafKey)}
          disabled={!canAssign}
          onChange={(event) => toggleKeys(event.target.checked)}
        />
        <span className="text-sm text-slate-800">{node.label}</span>
      </label>
    );
  }

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div
        className="flex items-center gap-1.5 bg-slate-50/80 px-2 py-1.5"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <button
          type="button"
          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-slate-200/80"
          aria-label={expanded ? `收起${node.label}` : `展开${node.label}`}
          onClick={() => onToggleOpen(node.id)}
        >
          {expanded ? (
            <IconChevronDown className="size-3.5" />
          ) : (
            <IconChevronRight className="size-3.5" />
          )}
        </button>
        <FolderCheckbox
          label={node.label}
          checked={allOn}
          indeterminate={someOn}
          disabled={readOnly || keys.length === 0}
          onChange={toggleKeys}
        />
        <span className="text-[11px] text-slate-400">
          {selectedCount}/{keys.length}
        </span>
      </div>
      {expanded ? (
        <div>
          {node.children?.map((child) => (
            <DirectoryNode
              key={child.id}
              node={child}
              depth={depth + 1}
              assignable={assignable}
              selected={selected}
              readOnly={readOnly}
              open={open}
              onToggleOpen={onToggleOpen}
              onChange={onChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FolderCheckbox({
  label,
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-slate-800">
      <input
        ref={ref}
        type="checkbox"
        aria-label={label}
        className="size-4 accent-slate-900 disabled:opacity-40"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
