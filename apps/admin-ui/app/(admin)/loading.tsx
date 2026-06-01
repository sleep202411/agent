/**
 * Route-level loading skeleton for every (admin) page. Shown by the App Router
 * while a server-rendered page awaits its data, so navigation between modules
 * gives immediate feedback instead of a blank/frozen frame.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      {/* Header block */}
      <div className="space-y-2 px-1 py-1">
        <div className="h-3 w-40 animate-pulse rounded bg-slate-100" />
        <div className="h-6 w-64 animate-pulse rounded bg-slate-200" />
        <div className="h-3 w-80 animate-pulse rounded bg-slate-100" />
      </div>
      {/* Metric row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white" />
        ))}
      </div>
      {/* Table block */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="h-10 border-b border-slate-200 bg-slate-50" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 border-b border-slate-100 px-3 py-3">
            <div className="h-4 w-full max-w-[60%] animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
