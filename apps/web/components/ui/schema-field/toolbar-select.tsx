/**
 * Compact native-shaped select for toolbars (image / video AI dialogs).
 *
 * Implementation note (May 2026): originally a browser-native select styled
 * with Tailwind + `color-scheme: dark`. Chromium on Windows does not
 * reliably honour `color-scheme` for the OS-painted popup
 * (see chromium issue 230258 and Microsoft Edge's 2022 "Styling select
 * for real" blog post). Swapped to a Radix-based shadcn Select so the
 * dropdown is fully DOM-rendered and theme-controlled.
 *
 * Public API kept identical so callers don't change.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ToolbarSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string; disabled?: boolean }[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;

  const dedupedOptions = options.filter(
    (opt, i, arr) => arr.findIndex((o) => o.value === opt.value) === i
  );

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 gap-2 rounded-lg border-0 bg-white/[0.04] px-3 text-[13px] text-white/85 hover:bg-white/[0.08] focus-visible:bg-white/[0.08]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {dedupedOptions.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
