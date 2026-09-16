"use client";
import { useCallback, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { fetchAdminOrderRevenueBreakdown } from "@/lib/admin-ip-commerce-client";
import type { AdminOrderRevenueBreakdownData } from "./types";
import { toErrorMessage } from "./shared";

export function useOrderRevenueBreakdown() {
  const { busy: loading, begin } = useAdminOperation();
  const pending = useRef<ReturnType<typeof begin>>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [data, setData] = useState<AdminOrderRevenueBreakdownData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(
    async (id: string) => {
      const operation = begin("read");
      if (!operation) return;
      pending.current = operation;
      setOrderId(id);
      setError(null);
      setData(null);
      try {
        const result = await fetchAdminOrderRevenueBreakdown(id, operation.signal);
        if (operation.current()) setData(result);
      } catch (err) {
        if (operation.current()) setError(toErrorMessage(err));
      } finally {
        operation.finish();
      }
    },
    [begin]
  );
  function close() {
    pending.current?.cancel();
    pending.current?.finish();
    pending.current = null;
    setOrderId(null);
    setData(null);
    setError(null);
  }
  return {
    data,
    loading,
    error,
    open,
    close,
    retry: () => {
      if (orderId) void open(orderId);
    },
  };
}
