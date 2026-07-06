"use client";

/**
 * Beta notice shown on entering an IP-direct play session — the backend is a
 * throwaway prototype with no persistence, so we tell the player up front.
 */

import { useEffect, useState } from "react";
import { Button3D } from "@/components/ui/button-3d";

const FONT =
  "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif";

export function BetaNotice() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="内测提示"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5 backdrop-blur-sm"
      style={{ fontFamily: FONT }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#1a2b33] p-7 text-center text-[#f1f7fb] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-[#24363f] text-3xl">
          🚧
        </div>
        <h2 className="text-xl font-extrabold">内测阶段</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-[#8ea6b2]">
          这是由 AI 现场生成的互动故事,目前处于内测阶段 —— 游玩进度暂不保存,每次进入都是全新的一局。
        </p>
        <Button3D block className="mt-6" onClick={() => setOpen(false)}>
          开始体验
        </Button3D>
      </div>
    </div>
  );
}
