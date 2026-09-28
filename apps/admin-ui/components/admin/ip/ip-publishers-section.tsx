"use client";

import { useEffect, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { Button } from "@/components/ui/button";
import { requestEnvelope, toErrorMessage } from "./shared";
import type { AdminIpPublishersData, IpPublisherAssignment, IpPublisherRow } from "./types";

export function IpPublishersSection({
  ipId,
  assigned,
  onSaved,
}: {
  ipId: string;
  assigned: IpPublisherAssignment[];
  onSaved: () => void;
}) {
  const { busy, begin } = useAdminOperation();
  const [catalog, setCatalog] = useState<IpPublisherRow[]>([]);
  const [selected, setSelected] = useState<string[]>(() => assigned.map((row) => row.id));
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSelected(assigned.map((row) => row.id));
  }, [assigned]);

  useEffect(() => {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    void requestEnvelope<AdminIpPublishersData>("/api/admin/ip-commerce/publishers", {
      signal: operation.signal,
    })
      .then((data) => {
        if (!operation.current()) return;
        setCatalog(data.items.filter((row) => row.status === "active"));
        setLoaded(true);
      })
      .catch((err) => {
        if (!operation.current()) return;
        setError(toErrorMessage(err));
      })
      .finally(() => operation.finish());
  }, [begin, ipId]);

  async function save() {
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await requestEnvelope(`/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/publishers`, {
        method: "PATCH",
        signal: operation.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publisherIds: selected }),
      });
      if (!operation.current()) return;
      onSaved();
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  const dirty =
    selected.length !== assigned.length ||
    selected.some((id) => !assigned.some((row) => row.id === id));

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-950">发行商</h4>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            FizzDragon 已确认合作的发行渠道；前台会展示 logo。
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => void save()} disabled={!dirty || busy}>
          保存绑定
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      {!loaded && !error ? <p className="mt-3 text-sm text-slate-500">加载发行商…</p> : null}
      <div className="mt-3 grid gap-2">
        {catalog.map((row) => {
          const checked = selected.includes(row.id);
          return (
            <label
              key={row.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(row.id)}
                disabled={busy}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.logoUrl} alt="" className="size-7 rounded object-contain bg-white" />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-950">{row.name}</span>
              <span className="text-[11px] text-slate-400">{row.code}</span>
            </label>
          );
        })}
        {loaded && catalog.length === 0 ? (
          <p className="text-sm text-slate-500">暂无启用中的发行商，请先到「发行商库」添加。</p>
        ) : null}
      </div>
      {assigned.some((row) => row.status === "inactive") ? (
        <p className="mt-3 text-[12px] text-amber-700">
          当前绑定含已停用发行商；保存时只会保留勾选的启用项。
        </p>
      ) : null}
    </section>
  );
}
