import type { ReactNode } from "react";

/**
 * Canonical admin page header. One consistent title block across every admin
 * page (IP, billing, users, audit, account, placeholders). Lightweight — no
 * card/border/shadow; the page content below provides the surfaces.
 *
 *   <PageHeader
 *     eyebrow="国际站 · 国际站生产数据库"
 *     title="IP 审核队列"
 *     description="所有 IP 档案发布审批集中在这里扫描。"
 *     actions={<Button …/>}   // optional right-aligned controls
 *   />
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Optional leading icon badge (e.g. an @tabler icon). */
  icon?: ReactNode;
  /** Right-aligned controls (filters, primary action). */
  actions?: ReactNode;
  /** Back-compat alias for `actions`. */
  children?: ReactNode;
}) {
  const right = actions ?? children;
  return (
    <section className="px-1 py-1">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? <p className="text-[12px] font-medium text-slate-500">{eyebrow}</p> : null}
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{title}</h2>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
            ) : null}
          </div>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </section>
  );
}
