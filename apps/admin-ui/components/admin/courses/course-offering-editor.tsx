"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { FormLabel, TextInput } from "@/components/admin/billing/shared";
import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";
import { useAdminOperation } from "../use-admin-operation";

type OfferingShare = { teacherId: string; shareBps: number };
type Offering = {
  version: number;
  teacherId: string;
  priceCredits: string;
  teacherShareBps: number;
  instructorShares?: OfferingShare[];
  enabled: boolean;
};
type Editor = {
  instructors: { userId: string | number; nickName?: string | null }[];
  offering: Offering | null;
};

type OfferingContextValue = {
  busy: boolean;
  data: Editor | null;
  error: string;
  teacher: string;
  setTeacher: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
  shares: Record<string, string>;
  setShareFor: (teacherId: string, value: string) => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  save: () => Promise<void>;
  load: () => Promise<void>;
};

const OfferingContext = createContext<OfferingContextValue | null>(null);

function useOffering() {
  const value = useContext(OfferingContext);
  if (!value) throw new Error("CourseOfferingProvider is required");
  return value;
}

export function useOfferingOptional() {
  return useContext(OfferingContext);
}

export function CourseOfferingProvider({
  courseId,
  children,
}: {
  courseId: string;
  children: ReactNode;
}) {
  const { begin, busy } = useAdminOperation();
  const [data, setData] = useState<Editor | null>(null);
  const [teacher, setTeacher] = useState("");
  const [price, setPrice] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});
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
      const loaded: Record<string, string> = {};
      if (result.offering?.instructorShares?.length) {
        for (const item of result.offering.instructorShares) {
          loaded[item.teacherId] = String(item.shareBps / 100);
        }
      } else if (result.offering?.teacherId) {
        loaded[result.offering.teacherId] = String(result.offering.teacherShareBps / 100);
      }
      setShares(loaded);
      setEnabled(result.offering?.enabled ?? false);
      setError("");
    } catch (e) {
      if (op.current()) setError(e instanceof Error ? e.message : "无法加载报名条款。");
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
  const setShareFor = useCallback((teacherId: string, value: string) => {
    setShares((current) => ({ ...current, [teacherId]: value }));
    setTeacher((current) => current || teacherId);
  }, []);
  const save = useCallback(async () => {
    if (!data) return;
    const op = begin();
    if (!op) return;
    const orderedIds = [
      ...data.instructors.map((item) => String(item.userId)),
      ...Object.keys(shares),
    ];
    const seen = new Set<string>();
    const payloadShares: OfferingShare[] = [];
    for (const id of orderedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const raw = shares[id]?.trim();
      if (!raw) continue;
      payloadShares.push({ teacherId: id, shareBps: Math.round(Number(raw) * 100) });
    }
    const teacherId = payloadShares[0]?.teacherId || teacher;
    const teacherShareBps = payloadShares[0]?.shareBps ?? 0;
    try {
      const saved = await parseAdminEnvelope<Offering>(
        await fetch(endpoint, {
          method: "PUT",
          signal: op.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacherId,
            priceCredits: price,
            teacherShareBps,
            shares: payloadShares,
            enabled,
            expectedVersion: data.offering?.version ?? 0,
          }),
        })
      );
      if (op.current()) {
        setData({ ...data, offering: saved });
        setTeacher(saved.teacherId);
        setError("");
      }
    } catch (e) {
      if (op.current()) setError(e instanceof Error ? e.message : "无法保存报名条款。");
    } finally {
      op.finish();
    }
  }, [begin, data, enabled, endpoint, price, shares, teacher]);
  const value = useMemo(
    () => ({
      busy,
      data,
      error,
      teacher,
      setTeacher,
      price,
      setPrice,
      shares,
      setShareFor,
      enabled,
      setEnabled,
      save,
      load,
    }),
    [busy, data, enabled, error, load, price, save, setShareFor, shares, teacher]
  );
  return <OfferingContext.Provider value={value}>{children}</OfferingContext.Provider>;
}

function OfferingStatus() {
  const { busy, data, error, load } = useOffering();
  if (error) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          重新加载
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <p role="status" className="text-sm text-slate-500">
        正在加载报名设置…
      </p>
    );
  }
  return null;
}

export function CoursePriceFields() {
  const { busy, data, price, setPrice, enabled, setEnabled, save } = useOffering();
  return (
    <div className="space-y-2">
      <OfferingStatus />
      {data ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FormLabel label="总费用（社区积分）">
            <TextInput
              required
              disabled={busy}
              type="number"
              min={0}
              max={999999999999}
              step={1}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </FormLabel>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-2 text-sm text-slate-700">
              <input
                disabled={busy}
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              开启报名
            </label>
            <Button disabled={busy} type="submit">
              保存费用
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
