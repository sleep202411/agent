import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt={compact ? "FizzDragon" : "FizzDragon 管理后台"}
      width={439}
      height={78}
      className={cn("h-auto w-[148px] select-none", className)}
      draggable={false}
      priority
    />
  );
}
