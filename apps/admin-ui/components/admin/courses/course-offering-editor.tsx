"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { useAdminOperation } from "../use-admin-operation";
type Offering = {
  version: number;
  teacherId: string;
  priceCredits: string;
  teacherShareBps: number;
  enabled: boolean;
};
type Editor = {
  instructors: { userId: string | number; nickName?: string | null }[];
  offering: Offering | null;
};
export function CourseOfferingEditor({ courseId }: { courseId: string }) {
  const { begin, busy } = useAdminOperation();
  const [data, setData] = useState<Editor | null>(null);
  const [teacher, setTeacher] = useState("");
  const [price, setPrice] = useState("");
  const [share, setShare] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const endpoint = adminUiApiPath(`/api/admin/academy/offerings/${encodeURIComponent(courseId)}`);
  const load = useCallback(async () => {
    const op = begin("read");
    if (!op) return;
    try {
      const result = await parseAdminEnvelope<Editor>(
        await fetch(endpoint, { signal: op.signal, cache: "no-store" })
      );
      if (!op.current()) return;
      setData(result);
      setTeacher(result.offering?.teacherId ?? "");
      setPrice(result.offering?.priceCredits ?? "");
      setShare(result.offering ? String(result.offering.teacherShareBps / 100) : "");
      setEnabled(result.offering?.enabled ?? false);
      setError("");
    } catch (e) {
      if (op.current()) setError(e instanceof Error ? e.message : "Could not load course terms.");
    } finally {
      op.finish();
    }
  }, [begin, endpoint]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);
  async function save() {
    if (!data) return;
    const op = begin();
    if (!op) return;
    try {
      const saved = await parseAdminEnvelope<Offering>(
        await fetch(endpoint, {
          method: "PUT",
          signal: op.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacherId: teacher,
            priceCredits: price,
            teacherShareBps: Math.round(Number(share) * 100),
            enabled,
            expectedVersion: data.offering?.version ?? 0,
          }),
        })
      );
      if (op.current()) {
        setData({ ...data, offering: saved });
        setError("");
      }
    } catch (e) {
      if (op.current()) setError(e instanceof Error ? e.message : "Could not save course terms.");
    } finally {
      op.finish();
    }
  }
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Enrollment and Teacher Revenue</h2>
      <p className="text-sm text-slate-600">
        Community-credit price and teacher share are fixed for each enrollment. Approval credits
        earned community credits, withdrawable at 100 credits = USD 1.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!data ? (
        <Button disabled={busy} onClick={() => void load()}>
          Load Course Terms
        </Button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1 text-sm">
            Reviewing Teacher
            <select
              required
              disabled={busy}
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              className="rounded border p-2"
            >
              <option value="">Select Instructor</option>
              {data.instructors.map((i) => (
                <option key={i.userId} value={String(i.userId)}>
                  {i.nickName || i.userId}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Price (Community Credits)
            <input
              required
              disabled={busy}
              type="number"
              min={0}
              max={999999999999}
              step={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Teacher Share (%)
            <input
              required
              disabled={busy}
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={share}
              onChange={(e) => setShare(e.target.value)}
              className="rounded border p-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              disabled={busy}
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enrollment Enabled
          </label>
          <Button disabled={busy} type="submit">
            Save Terms
          </Button>
        </form>
      )}
    </section>
  );
}
