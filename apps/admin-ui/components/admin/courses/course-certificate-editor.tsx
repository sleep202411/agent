"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { useAdminOperation } from "../use-admin-operation";

type Mapping = {
  courseId: string;
  certificateId: number | null;
  version: number;
  certificates: { id: number; name: string }[];
};

export function CourseCertificateEditor({ courseId }: { courseId: string }) {
  const { begin, busy } = useAdminOperation();
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const response = await fetch(
        adminUiApiPath(`/api/admin/academy/course-certificates/${encodeURIComponent(courseId)}`),
        { signal: operation.signal, cache: "no-store" }
      );
      const result = await parseAdminEnvelope<Mapping>(response);
      if (!operation.current()) return;
      setMapping(result);
      setSelected(result.certificateId === null ? "" : String(result.certificateId));
      setSaved(false);
    } catch (cause) {
      if (operation.current())
        setError(cause instanceof Error ? cause.message : "Could not load the course certificate.");
    } finally {
      operation.finish();
    }
  }, [begin, courseId]);
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
    if (!mapping) return;
    const operation = begin();
    if (!operation) return;
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        adminUiApiPath(`/api/admin/academy/course-certificates/${encodeURIComponent(courseId)}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: operation.signal,
          body: JSON.stringify({
            certificateId: selected ? Number(selected) : null,
            expectedVersion: mapping.version,
          }),
        }
      );
      const result = await parseAdminEnvelope<Mapping>(response);
      if (!operation.current()) return;
      setMapping(result);
      setSaved(true);
    } catch (cause) {
      if (operation.current())
        setError(cause instanceof Error ? cause.message : "Could not save the course certificate.");
    } finally {
      operation.finish();
    }
  }

  const missing =
    mapping?.certificateId !== null &&
    mapping?.certificateId !== undefined &&
    !mapping.certificates.some((item) => item.id === mapping.certificateId);
  return (
    <section
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      aria-labelledby="course-certificate-heading"
    >
      <h2 id="course-certificate-heading" className="text-sm font-semibold text-slate-900">
        Academy Skill Certificate
      </h2>
      <p className="text-sm text-slate-600">
        The badge associated with this course. This mapping does not award certificates to students.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {mapping ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm text-slate-700">
            Certificate
            <select
              aria-label="Course certificate"
              className="min-w-64 rounded-md border border-slate-300 p-2"
              value={selected}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value);
                setSaved(false);
              }}
            >
              <option value="">No certificate assigned</option>
              {missing && (
                <option value={String(mapping.certificateId)} disabled>
                  Unavailable certificate #{mapping.certificateId}
                </option>
              )}
              {mapping.certificates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} (#{item.id})
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => void save()}
            disabled={
              busy ||
              selected === (mapping.certificateId === null ? "" : String(mapping.certificateId))
            }
          >
            {busy ? "Saving…" : "Save Certificate"}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-emerald-700">
              Certificate mapping saved.
            </span>
          )}
        </div>
      ) : (
        !error && (
          <p role="status" className="text-sm text-slate-500">
            Loading certificate mapping…
          </p>
        )
      )}
      {error && (
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          Reload Mapping
        </Button>
      )}
    </section>
  );
}
