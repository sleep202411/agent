"use client";
import { IpSubmissionsPanel } from "./submissions-panel";
import { useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { requestEnvelope, toErrorMessage } from "./shared";
export function IpChannelPanel({
  ipId,
  version,
  channelType,
  onSaved,
}: {
  ipId: string;
  version: number;
  channelType?: "ip" | "community";
  onSaved: () => void;
}) {
  const [value, setValue] = useState(channelType ?? "community");
  const [error, setError] = useState<string | null>(null);
  const { busy, begin } = useAdminOperation();
  async function save() {
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await requestEnvelope(`/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/channel`, {
        method: "PATCH",
        signal: operation.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelType: value, expectedVersion: version }),
      });
      if (operation.current()) onSaved();
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 p-4">
      <label className="block text-sm font-medium" htmlFor="ip-channel-type">
        Channel category / 频道类别
      </label>
      <div className="flex gap-3">
        <select
          id="ip-channel-type"
          className="rounded-md border border-slate-300 p-2 text-sm"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value as "ip" | "community")}
        >
          <option value="ip">IP Channel / IP 频道</option>
          <option value="community">Community Channel / 社区频道</option>
        </select>
        <button
          type="button"
          disabled={busy || value === channelType}
          onClick={() => void save()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save category"}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Sets the category badge. All channels appear together in IP Plaza and TV.
      </p>
      {channelType === "community" && <IpSubmissionsPanel key={ipId} ipId={ipId} />}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
