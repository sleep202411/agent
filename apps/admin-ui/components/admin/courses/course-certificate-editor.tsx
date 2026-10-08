"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/admin/billing/shared";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { useAdminOperation } from "../use-admin-operation";

type Level = { id: number; name: string };

export function CourseCertificateEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { begin, busy } = useAdminOperation();
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const result = await parseAdminEnvelope<Level[]>(
        await fetch(adminUiApiPath("/api/admin/user-levels/levels"), {
          signal: operation.signal,
          cache: "no-store",
        })
      );
      if (!operation.current()) return;
      setLevels(
        [...result]
          .sort((left, right) => left.id - right.id)
          .map((item) => ({
            id: item.id,
            name: item.name,
          }))
      );
    } catch (cause) {
      if (operation.current())
        setError(cause instanceof Error ? cause.message : "无法加载认证等级。");
    } finally {
      operation.finish();
    }
  }, [begin]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  const missing = Boolean(value) && !(levels ?? []).some((item) => String(item.id) === value);

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {levels ? (
        <FormLabel label="认证" help="完成课程后可以获得相应认证">
          <select
            aria-label="课程证书"
            title="完成课程后可以获得相应认证"
            value={value}
            disabled={busy}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
          >
            <option value="">未指定证书</option>
            {missing && <option value={value}>证书不可用 #{value}</option>}
            {levels.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>
        </FormLabel>
      ) : (
        !error && (
          <p role="status" className="text-sm text-slate-500">
            正在加载认证…
          </p>
        )
      )}
      {error && (
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          重新加载
        </Button>
      )}
    </div>
  );
}
