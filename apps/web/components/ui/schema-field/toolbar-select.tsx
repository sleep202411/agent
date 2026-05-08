/**
 * Compact native select for toolbars.
 * Dark-themed, rounded, consistent across image/video dialogs.
 *
 * `[color-scheme:dark]` on the `<select>` is **load-bearing**: native
 * `<select>` dropdown panels are painted by the OS/browser chrome, not
 * the DOM, so plain Tailwind colours can't reach them. Setting
 * `color-scheme: dark` on the element itself tells macOS Chrome /
 * Safari to render the OS-level menu in dark mode (white panel →
 * dark panel with light hover band). Without this, the menu
 * occasionally falls back to light when an ancestor's `color-scheme`
 * inheritance gets disrupted (rare, but very jarring against the
 * surrounding dark dialog).
 */
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

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 appearance-none rounded-lg bg-white/[0.04] pl-3 pr-7 text-[13px] text-white/85 outline-none transition-colors [color-scheme:dark] hover:bg-white/[0.08] focus:bg-white/[0.08]"
      >
        {options
          .filter((opt, i, arr) => arr.findIndex((o) => o.value === opt.value) === i)
          .map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/50">
        ▼
      </span>
    </div>
  );
}
