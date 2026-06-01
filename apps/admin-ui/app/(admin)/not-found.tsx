/**
 * In-shell 404 for the (admin) segment. Renders inside the admin layout so a
 * mistyped/removed admin path keeps the nav rather than dropping to a bare page.
 */
import Link from "next/link";
import { IconCompass } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-slate-100 text-slate-500">
          <IconCompass className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-slate-950">页面不存在</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          这个地址没有对应的后台页面，可能已被移动或下线。
        </p>
        <div className="mt-5 flex justify-center">
          <Button asChild>
            <Link href="/">返回运营总览</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
