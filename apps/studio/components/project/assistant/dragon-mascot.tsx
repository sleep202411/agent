"use client";

import { DragonIcon } from "@/components/project/assistant/dragon-icon";
import { cn } from "@/lib/utils";

interface DragonMascotProps {
  active?: boolean;
  onClick?: () => void;
  rightOffset?: string;
}

export function DragonMascot({
  active = false,
  onClick,
  rightOffset = "1.5rem",
}: DragonMascotProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group fixed bottom-6 z-[80] flex flex-col items-center gap-1 px-2 py-3 transition-all duration-300"
      )}
      style={{ right: rightOffset }}
      aria-label="打开 AI 助手"
    >
      <div
        className={cn(
          "relative size-[50px] transition-transform duration-300",
          active ? "scale-110" : "group-hover:scale-110"
        )}
      >
        <DragonIcon
          className={cn(
            "relative z-[1] size-full [filter:drop-shadow(0_2px_6px_rgba(229,34,39,0.4))]",
            active
              ? "animate-[dragon-float_2s_ease-in-out_infinite]"
              : "group-hover:animate-[dragon-float_2s_ease-in-out_infinite]"
          )}
        />
        <span className="absolute left-1/2 top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFD700] shadow-[0_0_6px_#FFD700] animate-[dragon-orbit_6s_linear_infinite]" />
        <span className="absolute left-1/2 top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFD700] shadow-[0_0_6px_#FFD700] animate-[dragon-orbit_8s_linear_infinite] [animation-delay:-2s]" />
        <span className="absolute left-1/2 top-1/2 size-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFA500] shadow-[0_0_6px_#FFA500] animate-[dragon-orbit_7s_linear_infinite] [animation-delay:-4s]" />
      </div>
      <span
        className={cn(
          "text-xs text-[#7B858C] transition-colors duration-200",
          active ? "text-[#E63946]" : "group-hover:text-[#E63946]"
        )}
      >
        AI 助手
      </span>
    </button>
  );
}
