"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  buildAssignablePermissionTree,
  collectPermissionKeys,
  dedicatedPermissionKeys,
} from "./permission-tree";
import type { AdminPermissionInfo } from "./types";

/**
 * Module-level permission picker only. Nested nav groups / pages stay in the
 * tree data for key collection, but are not shown — operators grant or revoke
 * a whole left-rail module at once.
 */
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

  if (!tree.length) {
    return <p className="text-sm text-slate-500">当前没有可分配的权限。</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      {tree.map((node) => {
        const allKeys = collectPermissionKeys(node);
        const keys = readOnly ? allKeys : allKeys.filter((key) => assignable.has(key));
        const selectedCount = keys.filter((key) => selected.includes(key)).length;
        const allOn = keys.length > 0 && selectedCount === keys.length;
        const someOn = selectedCount > 0 && !allOn;

        function toggleKeys(nextOn: boolean) {
          const keep = selected.filter((key) => !keys.includes(key));
          onChange(nextOn ? [...keep, ...keys] : keep);
        }

        return (
          <div
            key={node.id}
            className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 last:border-b-0"
          >
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
        );
      })}
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
