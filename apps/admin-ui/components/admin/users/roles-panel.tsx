"use client";

import { IconCheck, IconMinus, IconShieldLock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ErrorBanner, Metric, PageHeader } from "./shared";
import type { AdminRolesData } from "./types";

export function RolesPanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminRolesData | null;
  initialError: string | null;
}) {
  const roles = initialData?.roles ?? [];
  const permissions = initialData?.permissions ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        icon={<IconShieldLock className="size-4" />}
        title="角色权限"
        description="后台角色与权限矩阵。角色与权限由系统预定义，账号通过分配角色获得对应权限（在「账号」页调整）。"
      />

      {initialError ? <ErrorBanner message={initialError} /> : null}

      {roles.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {roles.map((role) => (
              <Metric
                key={role.key}
                label={role.name}
                value={`${role.accountCount} 账号`}
                helper={`${role.permissions.length} / ${permissions.length} 项权限`}
              />
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                    权限
                  </th>
                  {roles.map((role) => (
                    <th
                      key={role.key}
                      className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px] font-medium text-slate-500"
                    >
                      <div className="font-semibold text-slate-700">{role.name}</div>
                      <div className="font-mono text-[10px] text-slate-400">{role.key}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission.key} className="hover:bg-slate-50/60">
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2.5">
                      <p className="text-sm font-medium text-slate-900">{permission.description}</p>
                      <p className="font-mono text-[11px] text-slate-400">{permission.key}</p>
                    </td>
                    {roles.map((role) => {
                      const granted = role.permissions.includes(permission.key);
                      return (
                        <td
                          key={role.key}
                          className="border-b border-slate-100 px-3 py-2.5 text-center"
                        >
                          {granted ? (
                            <IconCheck className="mx-auto size-4 text-emerald-600" />
                          ) : (
                            <IconMinus className="mx-auto size-4 text-slate-300" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            {roles.map((role) => (
              <div
                key={role.key}
                className={cn(
                  "rounded-lg border border-slate-200 px-3 py-2.5 text-[13px] text-slate-600"
                )}
              >
                <span className="font-medium text-slate-900">{role.name}</span>
                <span className="ml-2 text-slate-500">{role.description}</span>
              </div>
            ))}
          </div>
        </>
      ) : !initialError ? (
        <p className="py-10 text-center text-sm text-slate-500">暂无角色数据。</p>
      ) : null}
    </div>
  );
}
