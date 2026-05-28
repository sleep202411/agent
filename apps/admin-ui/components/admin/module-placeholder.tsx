import { IconArrowRight, IconChecklist } from "@tabler/icons-react";

export function ModulePlaceholder({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50">
        <p className="text-[12px] font-medium tracking-[0.16em] text-slate-500">后台模块</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-950">建设范围</h3>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
            即将接入
          </span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white text-slate-500">
                <IconChecklist className="size-4" />
              </span>
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-slate-600">{item}</p>
              <IconArrowRight className="mt-1 size-3.5 shrink-0 text-slate-400" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
