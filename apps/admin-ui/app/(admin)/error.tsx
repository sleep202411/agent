"use client";

/**
 * Route-level error boundary for the (admin) segment. Catches render/data errors
 * in any admin page and offers a retry instead of crashing the whole shell.
 */
import { useEffect } from "react";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-red-50 text-red-500">
          <IconAlertTriangle className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-slate-950">页面加载失败</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          这个页面在加载数据时出错了。可以重试，或返回上一页。
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-slate-400">错误编号：{error.digest}</p>
        ) : null}
        <div className="mt-5 flex justify-center">
          <Button type="button" onClick={() => reset()}>
            <IconRefresh className="size-4" />
            重试
          </Button>
        </div>
      </div>
    </div>
  );
}
