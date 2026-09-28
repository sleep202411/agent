import { FrostedPanel } from "@/components/ui/frosted-panel";

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <FrostedPanel className="px-5 py-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </FrostedPanel>
  );
}

export function UsageBar({
  label,
  value,
  max,
  trailing,
}: {
  label: string;
  value: number;
  max: number;
  trailing: string;
}) {
  const width = `${Math.max(4, Math.min(100, Math.round((value / (max || 1)) * 100)))}%`;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate font-medium text-white/80">{label}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{trailing}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-white/70" style={{ width }} />
      </div>
    </div>
  );
}
